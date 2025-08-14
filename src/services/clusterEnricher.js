import {
  supabase,
  selectRecords,
  insertRecord,
  updateRecord,
} from "../config/database.js";
import { generateAIContent } from "./gemini.js";
import { createContextLogger } from "../config/logger.js";
import { normalizeBcp47 } from "../utils/lang.js";

const logger = createContextLogger("ClusterEnricher");

export async function enrichPendingClusters(lang = "en") {
  if (process.env.CLUSTER_ENRICH_ENABLED === "false") return { processed: 0 };

  try {
    // Prefer SQL helper when available, fallback to client-side check
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
    const clusters = clusterIds.length
      ? (
          await Promise.all(
            clusterIds.map(
              async (id) => (await selectRecords("clusters", { id }))[0]
            )
          )
        ).filter(Boolean)
      : [];
  let processed = 0;
    for (const c of clusters) {
      // Check if has current ai
      const ai = await selectRecords("cluster_ai", {
        cluster_id: c.id,
        is_current: true,
        lang,
      });
      if (ai.length) continue;

      // Gather last article in cluster as a trivial summary basis
      const updates = await fetchClusterUpdates(c.id, 3);
      let title;
      let summary;
      if (
        (process.env.CLUSTER_LLM_ENABLED || "false").toLowerCase() === "true"
      ) {
        const prompt = buildClusterSummaryPrompt(c, updates, lang);
        try {
          const text = await generateAIContent(prompt, {
            maxOutputTokens: 600,
            temperature: 0.4,
            attempts: 2,
          });
          const parsed = safeParseJSON(text);
          title = parsed.ai_title || generateTitleFromUpdates(updates);
          summary = parsed.ai_summary || generateSummaryFromUpdates(updates);
        } catch (e) {
          logger.warn("LLM cluster summary failed; using fallback", {
            clusterId: c.id,
            error: e.message,
          });
          title = generateTitleFromUpdates(updates);
          summary = generateSummaryFromUpdates(updates);
        }
      } else {
        title = generateTitleFromUpdates(updates);
        summary = generateSummaryFromUpdates(updates);
      }

      // Mark previous as not current
      try {
        await updatePreviousClusterAI(c.id, lang);
      } catch (_) {}

      // Insert new
      await insertRecord("cluster_ai", {
        cluster_id: c.id,
        lang,
        ai_title: title,
        ai_summary: summary,
        ai_details: summary,
        model: "stub",
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
  let title;
  let summary;
  if ((process.env.CLUSTER_LLM_ENABLED || "false").toLowerCase() === "true") {
    const prompt = buildClusterSummaryPrompt(c, updates, lang);
    try {
      const text = await generateAIContent(prompt, {
        maxOutputTokens: 600,
        temperature: 0.4,
        attempts: 2,
      });
      const parsed = safeParseJSON(text);
      title = parsed.ai_title || generateTitleFromUpdates(updates);
      summary = parsed.ai_summary || generateSummaryFromUpdates(updates);
    } catch (e) {
      logger.warn("LLM cluster summary failed; using fallback", {
        clusterId: c.id,
        error: e.message,
      });
      title = generateTitleFromUpdates(updates);
      summary = generateSummaryFromUpdates(updates);
    }
  } else {
    title = generateTitleFromUpdates(updates);
    summary = generateSummaryFromUpdates(updates);
  }
  try {
    await updatePreviousClusterAI(c.id, lang);
  } catch (_) {}
  await insertRecord("cluster_ai", {
    cluster_id: c.id,
    lang,
    ai_title: title,
    ai_summary: summary,
    ai_details: summary,
    model: (process.env.LLM_MODEL || "stub"),
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
    } catch (_) {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildClusterSummaryPrompt(cluster, updates, lang) {
  const lines = updates
    .slice(0, 5)
    .map(
      (u) =>
        `- ${u.happened_at || u.created_at} | ${
          u.source_id || "src"
        } | stance=${u.stance || ""} | ${u.claim || u.summary || "update"}`
    )
    .join("\n");
  return `You are summarizing a news story cluster for language ${lang}. Input provides latest updates with source and stance. Be neutral and factual.

Return STRICT JSON only: {"ai_title":"...","ai_summary":"..."}

Updates:\n${lines}`;
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
