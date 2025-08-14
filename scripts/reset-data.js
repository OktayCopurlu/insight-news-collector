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
import { createContextLogger } from "../src/config/logger.js";

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
  const crawlResult = await crawlAllFeeds();
  logger.info("Re-crawl complete", crawlResult);
  logger.info("Reset finished.");
}

reset().catch((e) => {
  logger.error("Reset failed", { error: e.message });
  process.exit(1);
});
