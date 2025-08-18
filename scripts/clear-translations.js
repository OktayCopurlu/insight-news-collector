#!/usr/bin/env node
/**
 * Clear the translations cache table (public.translations).
 * Safe to run anytime; this table is an optional cache only.
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
const logger = createContextLogger("ClearTranslations");

async function confirm() {
  if (process.env.RUN_NON_INTERACTIVE === "1") return true;
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      "This will DELETE all rows from the translations cache. Continue? (yes/no) ",
      (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase() === "yes");
      }
    );
  });
}

async function truncateFast() {
  const sql = `TRUNCATE translations RESTART IDENTITY;`;
  logger.info("Attempting TRUNCATE", { sql });
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) throw error;
  logger.info("TRUNCATE succeeded");
}

async function deleteFallback() {
  logger.info("Falling back to iterative delete on translations");
  const { error } = await supabase
    .from("translations")
    .delete()
    .not("key", "is", null);
  if (error) throw error;
}

async function verifyCount() {
  const { count, error } = await supabase
    .from("translations")
    .select("key", { count: "exact", head: true });
  if (error) throw error;
  return count || 0;
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

  let usedTruncate = false;
  try {
    await truncateFast();
    usedTruncate = true;
  } catch (e) {
    logger.warn("TRUNCATE failed, using delete fallback", { error: e.message });
    await deleteFallback();
  }

  const remaining = await verifyCount();
  logger.info("Translations table cleared", {
    method: usedTruncate ? "truncate" : "delete",
    remaining,
  });
  console.log(JSON.stringify({ success: true, remaining }, null, 2));
}

run().catch((e) => {
  logger.error("Clear translations failed", { error: e.message });
  console.error(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
