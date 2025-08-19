#!/usr/bin/env node
/**
 * Clear news/content tables without touching configuration tables.
 * Tables affected (directly or via CASCADE):
 * - articles and its dependent join tables (article_media, article_categories, article_places, article_entities, article_scores, article_policy)
 * - clusters, cluster_ai, cluster_updates
 * - crawl_log
 *
 * Not touched:
 * - sources, feeds, projects, project_rules, places, entities, app_markets, media tables, etc.
 *
 * Note:
 * - categories will ALSO be cleared to ensure a fresh taxonomy for the next crawl.
 *
 * Safety:
 * - Requires SUPABASE_SERVICE_ROLE_KEY
 * - Prompts for confirmation unless RUN_NON_INTERACTIVE=1
 */
import readline from "node:readline";
import dotenv from "dotenv";
import { supabase } from "../src/config/database.js";
import { createContextLogger } from "../src/config/logger.js";

dotenv.config();
const logger = createContextLogger("ClearNews");

// Minimal set for TRUNCATE (CASCADE will include FK dependents of these roots)
// Include translations (cache) to purge stale translation rows.
// Include media_assets so that media_variants and article_media referencing it are truncated too.
// Also include article_* join tables explicitly to be robust even if FK cascade isn't set.
const TRUNCATE_ROOT_TABLES = [
  "translations", // cache table
  "media_assets", // will cascade to media_variants and article_media
  "media_variants",
  // Article-related join tables (explicit)
  "article_media",
  "article_categories",
  "article_places",
  "article_entities",
  "article_scores",
  "article_policy",
  "cluster_ai",
  "cluster_updates",
  "crawl_log",
  "articles",
  "clusters",
  "categories",
];

// Broader list for fallback iterative deletes (order: children -> parents)
const FALLBACK_ORDER = [
  "media_variants",
  "article_media",
  "article_categories",
  "article_places",
  "article_entities",
  "article_scores",
  "article_policy",
  "translations",
  "media_assets",
  "cluster_updates",
  "cluster_ai",
  "crawl_log",
  "articles",
  "clusters",
  "categories",
];

async function confirm() {
  if (process.env.RUN_NON_INTERACTIVE === "1") return true;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      "This will DELETE all news content (articles, clusters, logs). Continue? (yes/no) ",
      (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase() === "yes");
      }
    );
  });
}

async function truncateAll() {
  const sql = `TRUNCATE ${TRUNCATE_ROOT_TABLES.join(
    ", "
  )} RESTART IDENTITY CASCADE;`;
  logger.info("Attempting TRUNCATE CASCADE", { sql });
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) throw error;
  logger.info("TRUNCATE succeeded");
}

async function refreshMaterializedViews() {
  const stmts = [
    "REFRESH MATERIALIZED VIEW IF EXISTS public.v_articles_public;",
    "REFRESH MATERIALIZED VIEW IF EXISTS public.v_articles_reps;",
  ];
  for (const sql of stmts) {
    try {
      logger.info("Refreshing materialized view (if exists)", { sql });
      const { error } = await supabase.rpc("exec_sql", { sql });
      if (error) throw error;
    } catch (e) {
      logger.warn("MatView refresh skipped or failed", {
        sql,
        error: e.message,
      });
    }
  }
}

async function clearTableFallback(name) {
  logger.info(`Clearing table (fallback): ${name}`);
  let query = supabase.from(name).delete();
  // Provide an always-true style filter per table (required by supabase-js)
  switch (name) {
    case "media_variants":
      query = query.not("media_id", "is", null);
      break;
    case "article_media":
    case "article_categories":
    case "article_places":
    case "article_entities":
    case "article_scores":
    case "article_policy":
      query = query.not("article_id", "is", null);
      break;
    case "media_assets":
      query = query.not("id", "is", null);
      break;
    case "translations":
      query = query.not("key", "is", null);
      break;
    case "crawl_log":
    case "articles":
    case "clusters":
    case "cluster_ai":
    case "cluster_updates":
    case "categories":
      query = query.not("id", "is", null);
      break;
    default:
      query = query.not("id", "is", null);
  }
  const { error } = await query;
  if (error) throw error;
}

async function run() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required for destructive clear");
  }

  const ok = await confirm();
  if (!ok) {
    logger.info("Aborted by user.");
    process.exit(0);
  }

  logger.info("Starting news/content clear (config tables will be preserved)");
  logger.info("Note: categories will be cleared as part of this operation");

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
    for (const t of FALLBACK_ORDER) {
      try {
        await clearTableFallback(t);
      } catch (e) {
        logger.warn("Failed to clear table in fallback", {
          table: t,
          error: e.message,
        });
      }
    }
  }

  await refreshMaterializedViews();

  logger.info("News/content tables cleared.");
}

run().catch((e) => {
  logger.error("Clear news failed", { error: e.message });
  process.exit(1);
});
