#!/usr/bin/env node
/**
 * Reset dynamic content tables (articles + AI + categorizations + scores + crawl logs)
 * WITHOUT dropping schema objects, then re-crawl all enabled feeds to repopulate
 * with fresh AI-enhanced data.
 *
 * Safety:
 * - Requires SUPABASE_SERVICE_ROLE_KEY
 * - Prompts for confirmation unless RUN_NON_INTERACTIVE=1
 */
import readline from "node:readline";
import dotenv from "dotenv";
import { supabase } from "../src/config/database.js";
import { crawlAllFeeds } from "../src/services/feedCrawler.js";
import { enrichPendingClusters } from "../src/services/clusterEnricher.js";
import { createContextLogger } from "../src/config/logger.js";
import { selectRecords } from "../src/config/database.js";
import { selectAttachBestImage } from "../src/services/mediaSelector.js";

dotenv.config();
const logger = createContextLogger("ResetData");

// Order matters only for fallback deletes (child -> parent)
const TABLES_IN_ORDER = [
  "article_categories", // no id column (composite PK)
  "article_scores", // PK article_id
  "article_ai", // has id
  "cluster_ai", // new: cluster summaries
  "cluster_updates", // new: timeline
  "crawl_log", // has id
  "articles", // has id (references sources)
  "clusters", // new: clusters (truncate after articles)
];

async function confirm() {
  if (process.env.RUN_NON_INTERACTIVE === "1") return true;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      "This will DELETE all article content & AI data. Continue? (yes/no) ",
      (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase() === "yes");
      }
    );
  });
}

async function truncateAll() {
  const sql = `TRUNCATE ${TABLES_IN_ORDER.join(
    ", "
  )} RESTART IDENTITY CASCADE;`;
  logger.info("Attempting TRUNCATE CASCADE", { sql });
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) throw error;
  logger.info("TRUNCATE succeeded");
}

async function clearTableFallback(name) {
  logger.info(`Clearing table (fallback): ${name}`);
  let query = supabase.from(name).delete();
  // Provide a always-true style filter per table (cannot delete without filter)
  switch (name) {
    case "article_categories":
      query = query.not("article_id", "is", null);
      break;
    case "article_scores":
      query = query.not("article_id", "is", null);
      break;
    case "article_ai":
      query = query.not("article_id", "is", null);
      break;
    case "crawl_log":
      query = query.not("id", "is", null);
      break;
    case "articles":
      query = query.not("id", "is", null);
      break;
    default:
      query = query.not("id", "is", null);
  }
  const { error } = await query;
  if (error) throw error;
}

async function reset() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required for destructive reset");
  }

  const ok = await confirm();
  if (!ok) {
    logger.info("Aborted by user.");
    process.exit(0);
  }

  logger.info("Starting content reset");

  let truncated = false;
  try {
    await truncateAll();
    truncated = true;
  } catch (e) {
    logger.warn("TRUNCATE failed, falling back to iterative deletes", {
      error: e.message,
    });
  }

  if (!truncated) {
    for (const t of TABLES_IN_ORDER) {
      await clearTableFallback(t);
    }
  }

  logger.info("Tables cleared. Re-crawling all enabled feeds...");
  // Optional limits for a quick reset: set CRAWL_PER_FEED_LIMIT and/or CRAWL_TOTAL_LIMIT
  const perFeedLimit = process.env.CRAWL_PER_FEED_LIMIT
    ? parseInt(process.env.CRAWL_PER_FEED_LIMIT, 10)
    : null;
  const totalLimit = process.env.CRAWL_TOTAL_LIMIT
    ? parseInt(process.env.CRAWL_TOTAL_LIMIT, 10)
    : null;
  const crawlOpts = {};
  if (Number.isFinite(perFeedLimit)) crawlOpts.perFeedLimit = perFeedLimit;
  if (Number.isFinite(totalLimit)) crawlOpts.totalLimit = totalLimit;
  const crawlResult = await crawlAllFeeds(crawlOpts);
  logger.info("Re-crawl complete", crawlResult);

  // Optionally: enrich clusters automatically for configured languages
  const runEnrich =
    (process.env.RUN_CLUSTER_ENRICH_AFTER_RESET || "true").toLowerCase() ===
    "true";
  if (runEnrich) {
    const langs = (
      process.env.CLUSTER_LANGS ||
      process.env.CLUSTER_LANG ||
      "en"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    logger.info("Enriching clusters after reset", { langs });
    for (const lang of langs) {
      try {
        const res = await enrichPendingClusters(lang, {
          overrideEnabled: true,
        });
        logger.info("Cluster enrich complete", { lang, ...res });
      } catch (e) {
        logger.warn("Cluster enrich failed (post-reset)", {
          lang,
          error: e.message,
        });
      }
    }
  } else {
    logger.info("Skipping cluster enrich after reset (flag disabled)");
  }

  // Optional: backfill media thumbnails for recent articles so FE regains images post-reset
  const mediaEnabled =
    (process.env.MEDIA_ENABLED || "false").toLowerCase() === "true";
  if (mediaEnabled) {
    const hours = parseInt(
      process.env.MEDIA_BACKFILL_ON_RESET_HOURS || "24",
      10
    );
    const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    logger.info("Backfilling media after reset", { hours, sinceIso });
    try {
      const articles = await selectRecords("articles", {});
      let attached = 0;
      for (const a of articles) {
        const publishedAt = a.published_at
          ? new Date(a.published_at).toISOString()
          : null;
        const createdAt = a.created_at
          ? new Date(a.created_at).toISOString()
          : null;
        const isRecent =
          (publishedAt && publishedAt >= sinceIso) ||
          (!publishedAt && createdAt && createdAt >= sinceIso);
        if (!isRecent) continue;
        try {
          const res = await selectAttachBestImage(a);
          if (res) attached++;
        } catch (e) {
          logger.warn("Media attach failed", { id: a.id, error: e.message });
        }
      }
      logger.info("Media backfill complete", { attached });
    } catch (e) {
      logger.warn("Media backfill skipped due to error", { error: e.message });
    }
  } else {
    logger.info("MEDIA_ENABLED is false; skipping media backfill.");
  }
  logger.info("Reset finished.");
}

reset().catch((e) => {
  logger.error("Reset failed", { error: e.message });
  process.exit(1);
});
