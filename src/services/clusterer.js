import {
  supabase,
  insertRecord,
  selectRecords,
  updateRecord,
} from "../config/database.js";
import { extractUpdateFromArticle } from "./updateExtractor.js";
import { createContextLogger } from "../config/logger.js";

const logger = createContextLogger("Clusterer");

function normalize(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function assignClusterForArticle(article, { sourceId } = {}) {
  try {
    if (article.cluster_id) {
      return article.cluster_id;
    }

    // Respect flag: only run when explicitly enabled
    if ((process.env.CLUSTERING_ENABLED || "false").toLowerCase() !== "true") {
      return null;
    }

    // Try similarity search (pg function) with thresholds
    const threshold = parseFloat(process.env.CLUSTER_TRGM_THRESHOLD || "0.55");
    const windowHours = parseInt(process.env.CLUSTER_TRGM_WINDOW_HOURS || "72");
    const limit = parseInt(process.env.CLUSTER_TRGM_LIMIT || "10");
    const title = article.title || "";
    const fullText = article.full_text || null;

    let bestClusterId = null;
    let bestSim = 0;
    try {
      const { data, error } = await supabase.rpc("find_similar_articles", {
        p_title: title,
        p_full_text: fullText,
        p_window_hours: windowHours,
        p_threshold: threshold,
        p_limit: limit,
      });
      if (error) throw error;
      if (Array.isArray(data)) {
        for (const row of data) {
          if (row.similarity >= threshold && row.cluster_id) {
            if (row.similarity > bestSim) {
              bestSim = row.similarity;
              bestClusterId = row.cluster_id;
            }
          }
        }
      }
    } catch (e) {
      logger.warn("Similarity search failed; defaulting to new cluster", {
        error: e.message,
      });
    }

    const clusterId = bestClusterId || article.id; // fallback: 1:1
    const fingerprint = normalize(article.title || article.snippet || "").slice(
      0,
      280
    );

    // Create or update cluster record
    const existing = await selectRecords("clusters", { id: clusterId });
    if (!existing.length) {
      try {
        await insertRecord("clusters", {
          id: clusterId,
          seed_article: article.id,
          rep_article: article.id,
          fingerprint,
          first_seen: article.published_at || new Date(),
          last_seen: article.published_at || new Date(),
          size: 1,
        });
      } catch (e) {
        if (!/duplicate key/i.test(e.message || "")) throw e;
      }
    } else if (bestClusterId) {
      try {
        await updateRecord("clusters", clusterId, {
          last_seen: article.published_at || new Date(),
          size: Math.max(1, (existing[0].size || 1) + 1),
        });
      } catch (e) {
        logger.warn("Failed to update cluster aggregates", {
          error: e.message,
        });
      }
    }

    // Link and write timeline update
    try {
      await updateRecord("articles", article.id, { cluster_id: clusterId });
      try {
        const upd = await extractUpdateFromArticle(article);
        await insertRecord("cluster_updates", {
          cluster_id: clusterId,
          article_id: article.id,
          happened_at: article.published_at,
          stance: upd.stance,
          claim: (upd.claim || "").slice(0, 200),
          evidence: upd.evidence,
          summary: (upd.summary || "").slice(0, 500),
          source_id: sourceId || article.source_id || null,
          lang: upd.lang,
        });
      } catch (e) {
        if (!/duplicate key|violates unique/i.test(e.message || "")) {
          logger.warn("Failed to write cluster update", { error: e.message });
        }
      }
    } catch (e) {
      logger.warn("Failed to set article.cluster_id", { error: e.message });
    }

    logger.debug("Cluster assigned", {
      articleId: article.id,
      clusterId,
      bestSim,
    });
    return clusterId;
  } catch (error) {
    logger.error("Cluster assignment failed", { error: error.message });
    return null;
  }
}
