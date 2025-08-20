#!/usr/bin/env node
import dotenv from "dotenv";
import { createContextLogger } from "../src/config/logger.js";
import { supabase } from "../src/config/database.js";
import { assignClusterForArticle } from "../src/services/clusterer.js";
import { enrichPendingClusters } from "../src/services/clusterEnricher.js";

dotenv.config();
const logger = createContextLogger("BackfillClusters");

async function main() {
  // Force-enable clustering/enrichment within this run
  process.env.CLUSTERING_ENABLED = "true";

  const sinceHours = parseInt(process.env.BACKFILL_SINCE_HOURS || "48", 10);
  const limit = parseInt(process.env.BACKFILL_LIMIT || "50", 10);
  const lang = process.env.CLUSTER_LANG || "en";

  const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  logger.info("Scanning articles for missing clusters", { sinceHours, limit });

  // Fetch recent articles missing cluster_id
  const { data: rows, error } = await supabase
    .from("articles")
    .select(
      "id, source_id, title, snippet, published_at, full_text, cluster_id"
    )
    .is("cluster_id", null)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("Query failed", { error: error.message });
    process.exit(1);
  }

  const articles = rows || [];
  let assigned = 0;
  for (const a of articles) {
    try {
      const cid = await assignClusterForArticle(a, { sourceId: a.source_id });
      if (cid) assigned += 1;
    } catch (e) {
      logger.warn("Assign failed", { articleId: a.id, error: e.message });
    }
  }
  logger.info("Cluster assignment done", {
    examined: articles.length,
    assigned,
  });

  // Enrich clusters to create cluster_ai (override flag)
  try {
    const res = await enrichPendingClusters(lang, { overrideEnabled: true });
    logger.info("Enrichment done", res);
  } catch (e) {
    logger.warn("Enrichment failed", { error: e.message });
  }
}

main().catch((e) => {
  console.error("Backfill crashed:", e);
  process.exit(1);
});
