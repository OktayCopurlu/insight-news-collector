#!/usr/bin/env node
import { selectRecords } from "../src/config/database.js";
import { selectAttachBestImage } from "../src/services/mediaSelector.js";
import { createContextLogger } from "../src/config/logger.js";

const logger = createContextLogger("MediaBackfill");

async function main() {
  const hours = parseInt(process.argv[2] || "24");
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  logger.info("Backfilling media for recent articles", { hours });
  const articles = await selectRecords("articles", {
    // simple filter; real impl could be a SQL RPC
  });
  let count = 0;
  for (const a of articles) {
    // Include by published_at or fallback to created_at when published_at is missing
    const publishedAt = a.published_at
      ? new Date(a.published_at).toISOString()
      : null;
    const createdAt = a.created_at
      ? new Date(a.created_at).toISOString()
      : null;
    const isRecent =
      (publishedAt && publishedAt >= since) ||
      (!publishedAt && createdAt && createdAt >= since);
    if (!isRecent) continue;
    try {
      const res = await selectAttachBestImage(a);
      if (res) count++;
    } catch (e) {
      logger.warn("Media attach failed", { id: a.id, error: e.message });
    }
  }
  logger.info("Backfill done", { attached: count });
}

main().catch((e) => {
  logger.error("Backfill error", { error: e.message });
  process.exit(1);
});
