import {
  supabase,
  selectRecords,
  insertRecord,
  updateRecord,
} from "../config/database.js";
import { generateAIContent } from "./gemini.js";
import { createContextLogger } from "../config/logger.js";
import { normalizeBcp47 } from "../utils/lang.js";
import { decodeHtmlEntities } from "../utils/helpers.js";

const logger = createContextLogger("ClusterEnricher");

export async function enrichPendingClusters(lang = "en", options = {}) {
  const overrideEnabled = options && options.overrideEnabled === true;
  if (process.env.CLUSTER_ENRICH_ENABLED === "false" && !overrideEnabled)
    return { processed: 0 };

  try {
    // Prefer SQL helper when available, fallback to client-side check
    let clusters = [];
    const force =
      (process.env.CLUSTER_ENRICH_FORCE || "false").toLowerCase() === "true";
    if (force) {
      // Force mode: re-enrich all clusters regardless of existing AI
      clusters = await selectRecords("clusters", {});
    } else {
      let clusterIds = [];
      try {
        const { data, error } = await supabase.rpc("clusters_needing_ai", {
          p_lang: lang,
        });
        if (error) throw error;
        clusterIds = (data || []).map((r) => r.cluster_id || r.id || r);
      } catch (_) {
        // Fallback: list all clusters and filter client-side
        const all = await selectRecords("clusters", {});
        clusterIds = all.map((c) => c.id);
      }

      // Load cluster rows for selected ids
      clusters = clusterIds.length
        ? (
            await Promise.all(
              clusterIds.map(
                async (id) => (await selectRecords("clusters", { id }))[0]
              )
            )
          ).filter(Boolean)
        : [];
    }
    // Removed minChars checks; we now use original article body as details
    let processed = 0;
    for (const c of clusters) {
      // Check if has current ai
      const ai = await selectRecords("cluster_ai", {
        cluster_id: c.id,
        is_current: true,
        lang,
      });
      if (ai.length && !force) continue;

      // Gather context from updates, sample articles, and existing article AI for richer details
      const updates = await fetchClusterUpdates(c.id, 5);
      const articles = await fetchClusterArticles(c.id, 5);
      const articleAIs = [];
      let title;
      let summary;
      let details;
      if (
        (process.env.CLUSTER_LLM_ENABLED || "false").toLowerCase() === "true"
      ) {
        const mode = (
          process.env.CLUSTER_DETAILS_MODE || "narrative"
        ).toLowerCase();
        const bullets = parseInt(process.env.CLUSTER_DETAIL_BULLETS || "8", 10);
        const prompt = buildClusterSummaryPrompt(
          c,
          updates,
          lang,
          articles,
          mode,
          bullets,
          articleAIs
        );
        try {
          const text = await generateAIContent(prompt, {
            maxOutputTokens: parseInt(
              process.env.CLUSTER_LLM_MAX_TOKENS || "900",
              10
            ),
            temperature: mode === "narrative" ? 0.5 : 0.4,
            attempts: 2,
          });
          const parsed = safeParseJSON(text);
          title = parsed.ai_title || generateTitleFromUpdates(updates);
          summary = parsed.ai_summary || generateSummaryFromUpdates(updates);
          details =
            parsed.ai_details ||
            composeNarrativeFromArticleAIs(articleAIs, summary);
        } catch (e) {
          logger.warn("LLM cluster summary/details failed; using fallback", {
            clusterId: c.id,
            error: e.message,
          });
          title = generateTitleFromUpdates(updates);
          summary = generateSummaryFromUpdates(updates);
          details = synthesizeDetailsFallback(
            updates,
            articles,
            summary,
            articleAIs
          );
        }
      } else {
        title = generateTitleFromUpdates(updates);
        summary = generateSummaryFromUpdates(updates);
      }

      // NEW: Use the representative (or seed) article original full_text as ai_details (no LLM body rewriting)
      try {
        const repId = c.rep_article || c.seed_article;
        if (repId) {
          const repRow = (await selectRecords("articles", { id: repId }))[0];
          if (repRow?.full_text) {
            details = decodeHtmlEntities(repRow.full_text);
          }
        }
      } catch (e) {
        logger.debug("rep article fetch failed", { error: e.message });
      }
      // Fallbacks if no body available
      if (!details || !String(details).trim()) {
        // Try longest article body from recent articles
        const byLen = [...(articles || [])]
          .filter((a) => (a.full_text || "").trim())
          .sort(
            (a, b) => (b.full_text || "").length - (a.full_text || "").length
          );
        details = decodeHtmlEntities(byLen[0]?.full_text || summary || "");
      }

      // Mark previous as not current
      try {
        await updatePreviousClusterAI(c.id, lang);
      } catch (e) {
        logger.debug("updatePreviousClusterAI failed (non-fatal)", {
          error: e.message,
        });
      }

      // Insert new
      await insertRecord("cluster_ai", {
        cluster_id: c.id,
        lang,
        ai_title: title,
        ai_summary: summary,
        ai_details: details,
        model: `${process.env.LLM_MODEL || "stub"}#body=orig`,
        is_current: true,
      });
      processed++;

      // Optional throttle between clusters when using LLM
      if (
        (process.env.CLUSTER_LLM_ENABLED || "false").toLowerCase() === "true"
      ) {
        const sleepMs = parseInt(process.env.CLUSTER_LLM_SLEEP_MS || "250");
        if (sleepMs > 0) await sleep(sleepMs);
      }
    }
    return { processed };
  } catch (error) {
    logger.error("Cluster enrich failed", { error: error.message });
    return { processed: 0, error: error.message };
  }
}

export async function enrichClustersAutoPivot() {
  if (process.env.CLUSTER_ENRICH_ENABLED === "false") return { processed: 0 };
  try {
    // Fetch clusters lacking any current AI (any lang)
    const allClusters = await selectRecords("clusters", {});
    let processed = 0;
    for (const c of allClusters) {
      const existing = await selectRecords("cluster_ai", {
        cluster_id: c.id,
        is_current: true,
      });
      if (existing.length) continue; // already has a pivot

      const lang = await selectDominantLanguageForCluster(c.id);
      await generateAndInsertClusterAI(c, lang);
      processed++;
    }
    return { processed };
  } catch (error) {
    logger.error("Auto-pivot cluster enrich failed", { error: error.message });
    return { processed: 0, error: error.message };
  }
}

async function selectDominantLanguageForCluster(clusterId) {
  // Prefer languages in updates; fallback to articles
  const upd = await selectRecords("cluster_updates", { cluster_id: clusterId });
  const counts = new Map();
  for (const u of upd) {
    const l = normalizeBcp47(u.lang || "");
    if (!l) continue;
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  if (!counts.size) {
    const arts = await selectRecords("articles", { cluster_id: clusterId });
    for (const a of arts) {
      const l = normalizeBcp47(a.language || "");
      if (!l) continue;
      counts.set(l, (counts.get(l) || 0) + 1);
    }
  }
  if (!counts.size) return "en";
  // pick max; if tie, prefer en
  let best = null;
  let bestCount = -1;
  for (const [l, n] of counts.entries()) {
    if (n > bestCount || (n === bestCount && l === "en")) {
      best = l;
      bestCount = n;
    }
  }
  return best || "en";
}

async function generateAndInsertClusterAI(c, lang) {
  // Guard: if already exists for this lang as current, skip
  const aiExisting = await selectRecords("cluster_ai", {
    cluster_id: c.id,
    is_current: true,
    lang,
  });
  if (aiExisting.length) return;

  const updates = await fetchClusterUpdates(c.id, 3);
  const articles = await fetchClusterArticles(c.id, 5);
  const articleAIs = [];
  let title;
  let summary;
  let details;
  if ((process.env.CLUSTER_LLM_ENABLED || "false").toLowerCase() === "true") {
    const prompt = buildClusterSummaryPrompt(
      c,
      updates,
      lang,
      articles,
      "narrative",
      8,
      articleAIs
    );
    try {
      const text = await generateAIContent(prompt, {
        maxOutputTokens: 600,
        temperature: 0.4,
        attempts: 2,
      });
      const parsed = safeParseJSON(text);
      title = parsed.ai_title || generateTitleFromUpdates(updates);
      summary = parsed.ai_summary || generateSummaryFromUpdates(updates);
      details =
        parsed.ai_details ||
        composeNarrativeFromArticleAIs(articleAIs, summary);
    } catch (e) {
      logger.warn("LLM cluster summary failed; using fallback", {
        clusterId: c.id,
        error: e.message,
      });
      title = generateTitleFromUpdates(updates);
      summary = generateSummaryFromUpdates(updates);
      details = synthesizeDetailsFallback(
        updates,
        articles,
        summary,
        articleAIs
      );
    }
  } else {
    title = generateTitleFromUpdates(updates);
    summary = generateSummaryFromUpdates(updates);
    details = synthesizeDetailsFallback(updates, articles, summary, articleAIs);
  }
  // NEW: Replace ai_details with the representative article's original full_text (no LLM body)
  try {
    const repId = c.rep_article || c.seed_article;
    if (repId) {
      const repRow = (await selectRecords("articles", { id: repId }))[0];
      if (repRow?.full_text) {
        details = decodeHtmlEntities(repRow.full_text);
      }
    }
  } catch (e) {
    logger.debug("rep article fetch failed", { error: e.message });
  }
  if (!details || !String(details).trim()) {
    const byLen = [...(articles || [])]
      .filter((a) => (a.full_text || "").trim())
      .sort((a, b) => (b.full_text || "").length - (a.full_text || "").length);
    details = decodeHtmlEntities(byLen[0]?.full_text || summary || "");
  }
  try {
    await updatePreviousClusterAI(c.id, lang);
  } catch (e) {
    logger.debug("updatePreviousClusterAI failed (non-fatal)", {
      error: e.message,
    });
  }
  await insertRecord("cluster_ai", {
    cluster_id: c.id,
    lang,
    ai_title: title,
    ai_summary: summary,
    ai_details: details || summary,
    model: `${process.env.LLM_MODEL || "stub"}#body=orig`,
    is_current: true,
  });
}

async function fetchClusterUpdates(clusterId, limit = 5) {
  // Minimal fetch via RPC-less path (select and sort client-side)
  const all = await selectRecords("cluster_updates", { cluster_id: clusterId });
  const sorted = all.sort(
    (a, b) =>
      new Date(b.happened_at || b.created_at) -
      new Date(a.happened_at || a.created_at)
  );
  return sorted.slice(0, limit);
}

async function fetchClusterArticles(clusterId, limit = 3) {
  const all = await selectRecords("articles", { cluster_id: clusterId });
  const sorted = all.sort(
    (a, b) => new Date(b.published_at) - new Date(a.published_at)
  );
  return sorted.slice(0, limit);
}

// fetchClusterArticleAIs removed — deprecated per-article AI

function trimText(text, maxChars) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return (
    text
      .slice(0, maxChars)
      .replace(/[\s\S]{0,200}$/m, "")
      .trim() + "…"
  );
}

function composeNarrativeFromArticleAIs(articleAIs, fallbackSummary) {
  if (!articleAIs || !articleAIs.length) return fallbackSummary || "";
  // Prefer the longest two narratives
  const items = [...articleAIs]
    .map((r) => ({
      text:
        (r.ai_details && r.ai_details.trim()) || (r.ai_summary || "").trim(),
      len: (r.ai_details && r.ai_details.length) || (r.ai_summary || "").length,
    }))
    .filter((x) => x.text)
    .sort((a, b) => b.len - a.len)
    .slice(0, 2);
  const combined = items.map((i) => i.text).join("\n\n");
  // Keep the narrative focused; cap to avoid overly long details
  return trimText(combined, 1800);
}

function synthesizeDetailsFallback(
  updates,
  articles,
  summary,
  articleAIs = []
) {
  const parts = [];
  const narrative = composeNarrativeFromArticleAIs(articleAIs, summary);
  if (narrative) parts.push(narrative.trim());
  if (updates && updates.length) {
    const top = updates.slice(0, 6);
    parts.push(
      "Timeline:\n" +
        top
          .map(
            (u) =>
              `• ${u.source_id || "src"}: ${u.summary || u.claim || "update"}`
          )
          .join("\n")
    );
  }
  if (articles && articles.length) {
    const topA = articles.slice(0, 3);
    parts.push(
      "Coverage:\n" +
        topA
          .map(
            (a) =>
              `• ${a.source_id || "source"} | ${new Date(
                a.published_at
              ).toISOString()} \u2014 ${a.title || a.snippet || "article"}`
          )
          .join("\n")
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

// appendTimelineCoverage removed — no longer used when details come from article body

function generateTitleFromUpdates(updates) {
  if (!updates || !updates.length) return null;
  const first = updates[0];
  return first.claim || null;
}

function generateSummaryFromUpdates(updates) {
  if (!updates || !updates.length) return null;
  return updates
    .map(
      (u) => `• ${u.source_id || "src"}: ${u.summary || u.claim || "update"}`
    )
    .join("\n");
}

async function updatePreviousClusterAI(clusterId, lang) {
  // Using raw supabase client is not exposed here; rely on updateRecord-like approach via RPC in future if needed
  // As a fallback, select then mark old ones not current
  const existing = await selectRecords("cluster_ai", {
    cluster_id: clusterId,
    lang,
    is_current: true,
  });
  for (const row of existing) {
    try {
      await updateRecord("cluster_ai", row.id, { is_current: false });
    } catch (_) {
      /* ignore updateRecord failure */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildClusterSummaryPrompt(
  cluster,
  updates,
  lang,
  articles = [],
  mode = "narrative",
  bullets = 8,
  articleAIs = []
) {
  const upLines = (updates || [])
    .slice(0, 6)
    .map(
      (u) =>
        `- ${u.happened_at || u.created_at} | ${u.source_id || "src"} | ${
          u.claim || u.summary || "update"
        }`
    )
    .join("\n");
  const artLines = (articles || [])
    .slice(0, 3)
    .map(
      (a) =>
        `- ${a.published_at} | ${a.source_id || "source"} | ${
          a.title || a.snippet || "article"
        }`
    )
    .join("\n");
  const aiNarratives = (articleAIs || [])
    .slice(0, 3)
    .map(
      (r, idx) =>
        `-- Narrative ${idx + 1} --\n${trimText(
          r.ai_details || r.ai_summary || "",
          1200
        )}`
    )
    .join("\n\n");
  // Add short content excerpts from article bodies to ground the summary without rewriting originals
  const contentExcerpts = (articles || [])
    .slice(0, 3)
    .map(
      (a, i) =>
        `-- Article ${i + 1} excerpt --\n${trimText(
          (a.full_text || a.snippet || "").toString(),
          1000
        )}`
    )
    .join("\n\n");
  const base = `You are summarizing a news story cluster for language ${lang}. Use ONLY facts from updates, article snippets, and the provided coverage narratives. Be neutral and factual. Avoid speculation. Use clear, concise language.`;
  if (mode === "narrative") {
    return `${base}

Return STRICT JSON only (minified) with these keys: {"ai_title":"...","ai_summary":"...","ai_details":"Paragraph1\\n\\nParagraph2"}
Constraints for ai_details: 3-5 short paragraphs totaling 1000-1600 characters; no list formatting; reference sources implicitly (no links). Prefer the coverage narratives where possible; reconcile differences neutrally.

Updates:\n${upLines}

Articles:\n${artLines}

Content excerpts (from original articles):\n${contentExcerpts}

Coverage narratives:\n${aiNarratives}`;
  }
  // bullets
  return `${base}

Return STRICT JSON only (minified): {"ai_title":"...","ai_summary":"...","ai_details":"• Bullet 1\n• Bullet 2"}

Bullet rules: ${bullets} bullets max, each <= 200 chars, no duplication, no speculation.

Updates:\n${upLines}

Articles:\n${artLines}

Content excerpts (from original articles):\n${contentExcerpts}

Coverage narratives:\n${aiNarratives}`;
}

function safeParseJSON(raw) {
  try {
    const cleaned = (raw || "")
      .trim()
      .replace(/^```(json)?\n?/i, "")
      .replace(/```\s*$/i, "");
    return JSON.parse(cleaned);
  } catch (_) {
    return {};
  }
}
