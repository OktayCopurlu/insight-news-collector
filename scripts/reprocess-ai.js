#!/usr/bin/env node
/**
 * Reprocess AI enhancements for articles whose current ai_details are bullet style or failed.
 * Requires AI_DETAILS_MODE env (set to narrative for narrative regeneration) + ENABLE_HTML_EXTRACTION optionally.
 */
import dotenv from "dotenv";
import { supabase } from "../src/config/database.js";
import { createContextLogger } from "../src/config/logger.js";
import { processArticleAI } from "../src/services/articleProcessor.js";

dotenv.config();
const logger = createContextLogger("ReprocessAI");

const LIMIT = parseInt(process.env.REPROCESS_LIMIT || "50");

async function fetchTargets() {
  const { data, error } = await supabase
    .from("article_ai")
    .select("article_id, ai_details, is_current, created_at")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data || []).filter(
    (r) =>
      !r.ai_details ||
      r.ai_details.startsWith("•") ||
      r.ai_details.includes("AI enhancement failed")
  );
}

async function fetchArticle(id) {
  const { data, error } = await supabase
    .from("articles")
    .select("id,title,snippet,language,canonical_url,url")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function markOldAsNotCurrent(articleId) {
  const { error } = await supabase
    .from("article_ai")
    .update({ is_current: false })
    .eq("article_id", articleId)
    .eq("is_current", true);
  if (error) throw error;
}

async function run() {
  logger.info("Starting AI reprocess");
  const targets = await fetchTargets();
  logger.info("Targets selected", { count: targets.length });
  let success = 0,
    failed = 0;
  for (const t of targets) {
    try {
      const article = await fetchArticle(t.article_id);
      await markOldAsNotCurrent(article.id);
      await processArticleAI(article); // will create new current row
      success++;
    } catch (e) {
      failed++;
      logger.warn("Reprocess failed", {
        articleId: t.article_id,
        error: e.message,
      });
    }
  }
  logger.info("Reprocess complete", { success, failed });
}

run().catch((e) => {
  logger.error("Fatal reprocess error", { error: e.message });
  process.exit(1);
});
