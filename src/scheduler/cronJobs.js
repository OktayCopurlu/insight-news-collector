import cron from "node-cron";
import { crawlAllFeeds } from "../services/feedCrawler.js";
import { enrichPendingClusters } from "../services/clusterEnricher.js";
import { runPretranslationCycle } from "../services/pretranslator.js";
// Per-article AI removed — no longer importing queue processors
import { supabase } from "../config/database.js";
import { createContextLogger } from "../config/logger.js";

const logger = createContextLogger("CronScheduler");

export const startCronJobs = () => {
  logger.info("Starting cron jobs");

  // Resolve cron expressions from env (defaults)
  const crawlExpr = process.env.CRON_CRAWL_EXPR || "*/5 * * * *";
  const pretransExpr = process.env.CRON_PRETRANS_EXPR || "*/5 * * * *";
  const cleanupExpr = process.env.CRON_CLEANUP_EXPR || "0 2 * * *";

  // Crawl feeds on schedule
  cron.schedule(
    crawlExpr,
    async () => {
      try {
        logger.info("Starting scheduled feed crawl");
        const perFeedLimit = process.env.CRAWL_PER_FEED_LIMIT
          ? parseInt(process.env.CRAWL_PER_FEED_LIMIT, 10)
          : null;
        const totalLimit = process.env.CRAWL_TOTAL_LIMIT
          ? parseInt(process.env.CRAWL_TOTAL_LIMIT, 10)
          : null;
        const opts = {};
        if (Number.isFinite(perFeedLimit)) opts.perFeedLimit = perFeedLimit;
        if (Number.isFinite(totalLimit)) opts.totalLimit = totalLimit;
        const results = await crawlAllFeeds(opts);
        logger.info("Scheduled feed crawl completed", results);
        // Optionally enrich clusters after crawl
        const enabled =
          (process.env.CLUSTER_ENRICH_ENABLED || "false").toLowerCase() ===
          "true";
        if (enabled) {
          const langs = (
            process.env.CLUSTER_LANGS ||
            process.env.CLUSTER_LANG ||
            "en"
          )
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const lang of langs) {
            try {
              const res = await enrichPendingClusters(lang);
              logger.info("Cluster enrich completed (cron)", { lang, ...res });
            } catch (e) {
              logger.warn("Cluster enrich failed (cron)", {
                lang,
                error: e.message,
              });
            }
          }
        }
      } catch (error) {
        logger.error("Scheduled feed crawl failed", { error: error.message });
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  // Per-article AI queue removed — no scheduled job

  // Pretranslation cycle every 5 minutes
  cron.schedule(
    pretransExpr,
    async () => {
      try {
        const enabled =
          (process.env.PRETRANS_ENABLED || "true").toLowerCase() !== "false";
        if (!enabled) return;
        logger.info("Starting pretranslation cycle");
        const res = await runPretranslationCycle();
        logger.info("Pretranslation cycle completed", res);
      } catch (error) {
        logger.warn("Pretranslation cycle failed", { error: error.message });
      }
    },
    { scheduled: true, timezone: "UTC" }
  );

  // Cleanup old logs daily at 2 AM
  cron.schedule(
    cleanupExpr,
    async () => {
      try {
        logger.info("Starting scheduled cleanup");
        await cleanupOldLogs();
      } catch (error) {
        logger.error("Scheduled cleanup failed", { error: error.message });
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  logger.info("Cron jobs started successfully");
};

// Per-article AI queue processor removed

const cleanupOldLogs = async () => {
  try {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

    const { error } = await supabase
      .from("crawl_log")
      .delete()
      .lt("created_at", cutoffDate.toISOString());

    if (error) throw error;

    logger.info("Old logs cleaned up", { cutoffDate });
  } catch (error) {
    logger.error("Log cleanup failed", { error: error.message });
    throw error;
  }
};

// stopCronJobs removed (unused)
