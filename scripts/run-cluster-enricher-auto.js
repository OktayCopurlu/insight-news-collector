#!/usr/bin/env node
import dotenv from "dotenv";
import { enrichClustersAutoPivot } from "../src/services/clusterEnricher.js";
import { createContextLogger } from "../src/config/logger.js";

dotenv.config();

const logger = createContextLogger("ClusterAutoPivotRunner");

async function main() {
  if ((process.env.CLUSTER_ENRICH_ENABLED || "false").toLowerCase() !== "true") {
    logger.info("Cluster enricher disabled by flag (CLUSTER_ENRICH_ENABLED)");
    process.exit(0);
  }
  const res = await enrichClustersAutoPivot();
  if (res.error) {
    logger.error("Cluster auto-pivot run failed", res);
    process.exit(1);
  }
  logger.info("Cluster auto-pivot run complete", res);
}

main().catch((e) => {
  console.error("Cluster auto-pivot crashed:", e);
  process.exit(1);
});
