#!/usr/bin/env node
import dotenv from "dotenv";
import { enrichPendingClusters } from "../src/services/clusterEnricher.js";
import { createContextLogger } from "../src/config/logger.js";

dotenv.config();

const logger = createContextLogger("ClusterEnricherRunner");

async function main() {
  const lang = process.env.CLUSTER_LANG || "en";
  if (
    (process.env.CLUSTER_ENRICH_ENABLED || "false").toLowerCase() !== "true"
  ) {
    logger.info("Cluster enricher disabled by flag (CLUSTER_ENRICH_ENABLED)");
    process.exit(0);
  }
  const res = await enrichPendingClusters(lang);
  if (res.error) {
    logger.error("Cluster enricher run failed", res);
    process.exit(1);
  }
  logger.info("Cluster enricher run complete", res);
}

main().catch((e) => {
  console.error("Cluster enricher crashed:", e);
  process.exit(1);
});
