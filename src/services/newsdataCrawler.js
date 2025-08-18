import axios from "axios";
import { supabase, selectRecords, insertRecord } from "../config/database.js";
import { processArticle } from "./articleProcessor.js";
import { createContextLogger } from "../config/logger.js";
import { generateContentHash } from "../utils/helpers.js";

const logger = createContextLogger("NewsdataCrawler");

async function ensureNewsdataSource() {
  const id = "newsdata";
  const existing = await selectRecords("sources", { id });
  if (existing && existing.length) return existing[0];
  try {
    const src = await insertRecord("sources", {
      id,
      name: "Newsdata.io",
      homepage: "https://newsdata.io",
      country: null,
      lang: null,
      terms_url: "https://newsdata.io/terms",
      allowed_use: "link+snippet",
      canonical_link_required: true,
    });
    logger.info("Created source entry for Newsdata.io", { sourceId: src.id });
    return src;
  } catch (e) {
    // In case of race, try to read again
    const fallback = await selectRecords("sources", { id });
    if (fallback && fallback.length) return fallback[0];
    throw e;
  }
}

function startOfUtcDay(date = new Date()) {
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  );
}

async function countFetchedToday(sourceId) {
  const since = startOfUtcDay();
  const { count, error } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .gte("fetched_at", since.toISOString());
  if (error) throw error;
  return count || 0;
}

async function fetchNewsdataPage({
  apiKey,
  q,
  language,
  country,
  category,
  page,
  pageSize,
}) {
  const url = "https://newsdata.io/api/1/latest";
  const params = {
    apikey: apiKey,
    q: q || undefined,
    language: language || undefined,
    country: country || undefined,
    category: category || undefined,
    size: pageSize || undefined,
    page: page || undefined,
  };
  const resp = await axios.get(url, {
    params,
    timeout: parseInt(process.env.FETCH_TIMEOUT_MS || "15000", 10),
  });
  const data = resp.data || {};
  const items = Array.isArray(data.results) ? data.results : [];
  const nextPage = data.nextPage || null;
  return { items, nextPage };
}

function mapNewsdataItemToArticle(item) {
  const title = item.title || "";
  const url = item.link || item.url || item.source_url || "";
  const snippet = item.description || item.content || item.snippet || "";
  const language = item.language || item.lang || "en";
  const published_at =
    item.pubDate || item.published_at || item.date || new Date().toISOString();
  return {
    title,
    url,
    canonical_url: url,
    snippet,
    language,
    published_at: new Date(published_at),
    content_hash: generateContentHash(title, snippet),
  };
}

async function logCrawlResult(articleUrl, status, message) {
  try {
    await insertRecord("crawl_log", {
      feed_id: null,
      article_url: articleUrl,
      status,
      message: String(message || "").substring(0, 500),
    });
  } catch (e) {
    logger.warn("Failed to log Newsdata crawl result", { error: e.message });
  }
}

export async function crawlNewsdataOnly(_options = {}) {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    throw new Error("NEWSDATA_API_KEY is missing");
  }

  await ensureNewsdataSource();
  const sourceId = "newsdata";

  const DAILY_LIMIT = parseInt(process.env.NEWSDATA_DAILY_LIMIT || "200", 10);
  let already = 0;
  try {
    already = await countFetchedToday(sourceId);
  } catch (e) {
    logger.warn(
      "Failed to count today's articles; proceeding with limit only",
      { error: e.message }
    );
  }
  let remaining = Math.max(DAILY_LIMIT - already, 0);
  if (remaining <= 0) {
    logger.info("Daily limit reached; skipping Newsdata crawl", {
      limit: DAILY_LIMIT,
      already,
    });
    return {
      mode: "newsdata_only",
      dailyLimit: DAILY_LIMIT,
      already,
      processed: 0,
      skipped: 0,
      errors: 0,
    };
  }

  const q = process.env.NEWSDATA_QUERY || undefined;
  const language = process.env.NEWSDATA_LANG || undefined; // comma-separated supported by API
  const country = process.env.NEWSDATA_COUNTRY || undefined;
  const category = process.env.NEWSDATA_CATEGORY || undefined;
  const pageSize = parseInt(process.env.NEWSDATA_PAGE_SIZE || "50", 10);

  let nextPage = undefined;
  const stats = {
    mode: "newsdata_only",
    dailyLimit: DAILY_LIMIT,
    already,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  logger.info("Starting Newsdata-only crawl", {
    remaining,
    q,
    language,
    country,
    category,
  });

  while (remaining > 0) {
    try {
      const { items, nextPage: np } = await fetchNewsdataPage({
        apiKey,
        q,
        language,
        country,
        category,
        page: nextPage,
        pageSize,
      });
      if (!items.length) {
        logger.info("No more items from Newsdata");
        break;
      }

      for (const raw of items) {
        if (remaining <= 0) break;
        try {
          const item = mapNewsdataItemToArticle(raw);
          const result = await processArticle(item, sourceId);
          if (result === null) {
            stats.skipped++;
            await logCrawlResult(
              item.url,
              "skipped",
              "Skipped due to missing/short full text"
            );
          } else {
            stats.processed++;
            remaining--;
            await logCrawlResult(
              item.url,
              "success",
              "Article processed successfully"
            );
          }
        } catch (e) {
          stats.errors++;
          logger.warn("Failed to process Newsdata article", {
            error: e.message,
          });
          await logCrawlResult(raw?.link || raw?.url || "", "error", e.message);
        }
      }

      if (!np) break;
      nextPage = np;
    } catch (e) {
      logger.error("Newsdata fetch failed", { error: e.message });
      break; // stop on fetch error to avoid loops
    }
  }

  logger.info("Newsdata-only crawl completed", stats);
  return stats;
}
