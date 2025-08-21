#!/usr/bin/env node
/**
 * Fetch a small batch from Newsdata and feed directly into the Gemini content pipeline.
 * Bypasses legacy processors. Intended for quick smoke-testing.
 */
import dotenv from "dotenv";
import axios from "axios";
import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";
import { fetchBestHtml } from "../src/services/htmlExtractor.js";
import { createContextLogger } from "../src/config/logger.js";
import { supabase } from "../src/config/database.js";
import { assignClusterForArticle } from "../src/services/clusterer.js";
import { selectAttachBestImage } from "../src/services/mediaSelector.js";
import { normalizeBcp47 } from "../src/utils/lang.js";

dotenv.config();
const logger = createContextLogger("Newsdata→GeminiSmoke");

const API_URL = "https://newsdata.io/api/1/latest";

function envList(v) {
  return String(v || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function insertArticleRow({ url, title, language, publishedAt }) {
  const payload = {
    url,
    title: title || null,
    language: language || null,
    published_at: publishedAt || null,
  };
  const { data, error } = await supabase
    .from("articles")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return data?.id;
}

async function fetchNewsdataOnce({
  apiKey,
  q,
  language,
  country,
  category,
  size,
  page,
}) {
  const params = {
    apikey: apiKey,
    q: q || undefined,
    // Newsdata may not support comma-separated languages in a single param; take the first if needed
    language:
      (language || "") && String(language).includes(",")
        ? String(language).split(",")[0].trim()
        : language || undefined,
    country: country || undefined,
    category: category || undefined,
    size: size || undefined,
    page: page || undefined,
  };
  let resp;
  try {
    resp = await axios.get(API_URL, {
      params,
      timeout: parseInt(process.env.FETCH_TIMEOUT_MS || "15000", 10),
      validateStatus: () => true,
    });
  } catch (e) {
    logger.warn("Newsdata request failed", { error: e.message });
    return { items: [], nextPage: null };
  }
  const data = resp.data || {};
  if (resp.status < 200 || resp.status >= 300) {
    logger.warn("Newsdata non-2xx response", {
      status: resp.status,
      data:
        typeof data === "object"
          ? JSON.stringify(data).slice(0, 500)
          : String(data).slice(0, 500),
    });
  }
  const items = Array.isArray(data.results) ? data.results : [];
  const nextPage = data.nextPage || null;
  return { items, nextPage };
}

// HTML fetching is delegated to fetchBestHtml (prefers Mercury HTML, falls back to raw)

async function main() {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    console.error("NEWSDATA_API_KEY is missing in .env");
    process.exit(1);
  }

  // CLI overrides: node scripts/newsdata-into-gemini.js [size]
  const sizeArg = parseInt(process.argv[2] || "0", 10);
  const size =
    sizeArg > 0
      ? sizeArg
      : parseInt(process.env.NEWSDATA_PAGE_SIZE || "10", 10);

  const q = process.env.NEWSDATA_QUERY || undefined;
  const language = process.env.NEWSDATA_LANG || undefined;
  const country = process.env.NEWSDATA_COUNTRY || undefined;
  const category = process.env.NEWSDATA_CATEGORY || undefined;

  logger.info("Fetching Newsdata batch", {
    size,
    q,
    language,
    country,
    category,
  });

  const { items } = await fetchNewsdataOnce({
    apiKey,
    q,
    language,
    country,
    category,
    size,
  });

  logger.info("Newsdata fetch done", { count: items.length });

  if (!items.length) {
    console.log(
      JSON.stringify(
        { success: true, processed: 0, skipped: 0, errors: 0 },
        null,
        2
      )
    );
    return;
  }

  const targets = envList(process.env.PRETRANSLATE_LANGS);
  let processed = 0,
    skipped = 0,
    errors = 0;
  const results = [];

  // Minimal concurrency (2) to avoid hammering
  const queue = [...items.slice(0, size)];
  async function worker() {
    while (queue.length) {
      const raw = queue.shift();
      const url = raw?.link || raw?.url || raw?.source_url;
      if (!url) {
        skipped++;
        continue;
      }
      let articleId = null;
      try {
        const t0 = Date.now();
        logger.info("Processing item", { url });
        const { html: rawHtml, language: pageLang } = await fetchBestHtml(url);
        // Ensure an article row exists to receive full_text updates
        try {
          articleId = await insertArticleRow({
            url,
            title: raw?.title || raw?.title_full || null,
            language: pageLang || raw?.language || null,
            publishedAt:
              raw?.pubDate || raw?.pub_date || raw?.published_at || null,
          });
        } catch (e) {
          logger.warn("Article insert failed; skipping item", {
            url,
            error: e.message,
          });
          skipped++;
          continue;
        }
        const res = await processAndPersistArticle({
          db: null,
          articleId,
          rawHtml,
          url,
          sourceLang:
            pageLang ||
            raw?.language ||
            process.env.DEFAULT_SOURCE_LANG ||
            "auto",
          targetLangs: targets.length ? targets : undefined,
        });
        // Optionally attach a best image (best-effort)
        try {
          const { data: artRow } = await supabase
            .from("articles")
            .select("id,title,snippet,full_text,language,published_at")
            .eq("id", articleId)
            .maybeSingle();
          if (artRow) {
            try {
              await selectAttachBestImage(artRow);
            } catch (e) {
              logger.debug("Image selection skipped", { error: e.message });
            }
            // Ensure minimal clustering so BFF /feed works (env-gated; default to true here)
            const prev = String(
              process.env.CLUSTERING_ENABLED || ""
            ).toLowerCase();
            if (!prev) process.env.CLUSTERING_ENABLED = "true";
            try {
              const clusterId = await assignClusterForArticle(artRow, {
                sourceId: raw?.source_id || null,
              });
              // Create minimal cluster_ai if missing (title/summary only)
              try {
                const lang = normalizeBcp47(artRow.language || "en");
                const { data: existing, error: exErr } = await supabase
                  .from("cluster_ai")
                  .select("id")
                  .eq("cluster_id", clusterId)
                  .eq("lang", lang)
                  .eq("is_current", true)
                  .maybeSingle();
                if (exErr) throw exErr;
                if (!existing) {
                  // Derive a minimal summary: prefer snippet, else first ~280 chars of the cleaned body
                  let derivedSummary = (artRow.snippet || "").toString().trim();
                  if (!derivedSummary) {
                    const { data: a2 } = await supabase
                      .from("articles")
                      .select("full_text")
                      .eq("id", articleId)
                      .maybeSingle();
                    const cleanedHtml = a2?.full_text || "";
                    const plain = cleanedHtml
                      .replace(/<[^>]+>/g, " ")
                      .replace(/\s+/g, " ")
                      .trim();
                    derivedSummary = plain.slice(0, 280);
                  }
                  const payload = {
                    cluster_id: clusterId,
                    lang,
                    ai_title: artRow.title || "(untitled)",
                    ai_summary: derivedSummary || artRow.title || "",
                    ai_details: artRow.snippet || artRow.title || "",
                    model: `${process.env.LLM_MODEL || "stub"}#seed=minimal`,
                    is_current: true,
                  };
                  const { error: insErr } = await supabase
                    .from("cluster_ai")
                    .insert(payload);
                  if (insErr) throw insErr;
                }
              } catch (e) {
                logger.debug("Minimal cluster_ai skipped", {
                  error: e.message,
                });
              }
            } catch (e) {
              logger.debug("Cluster assignment skipped", { error: e.message });
            } finally {
              if (!prev) delete process.env.CLUSTERING_ENABLED; // restore
            }
          }
        } catch (e) {
          logger.debug("Post-process enrichment skipped", { error: e.message });
        }
        const dt = Date.now() - t0;
        results.push({
          articleId,
          url,
          ms: dt,
          cleanedBytes: res.cleanedBytes,
          cleanedHash: res.cleanedHash,
          targets: res.targets,
          results: res.results,
        });
        processed++;
      } catch (e) {
        errors++;
        logger.warn("Failed to process news item", { url, error: e.message });
      }
    }
  }

  await Promise.all([worker(), worker()]);

  console.log(
    JSON.stringify(
      { success: true, processed, skipped, errors, batch: results },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message }, null, 2));
  process.exit(2);
});
