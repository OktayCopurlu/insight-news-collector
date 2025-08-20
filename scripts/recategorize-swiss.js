#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { supabase } from "../src/config/database.js";
import { createContextLogger } from "../src/config/logger.js";
import { persistArticleCategories } from "../src/services/articleProcessor.js";

const logger = createContextLogger("RecategorizeSwiss");

async function fetchArticles(limit = 50) {
  const { data, error } = await supabase
    .from("articles")
    .select("id,title,snippet,language")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function main() {
  const limit = parseInt(process.env.RECAT_LIMIT || "50", 10);
  process.env.PREFERRED_GEO_COUNTRY =
    process.env.PREFERRED_GEO_COUNTRY || process.env.NEWSDATA_COUNTRY || "ch";
  logger.info("Recategorizing latest articles with Swiss preference", {
    limit,
    preferred: process.env.PREFERRED_GEO_COUNTRY,
  });
  const articles = await fetchArticles(limit);
  let ok = 0,
    fail = 0;
  for (const a of articles) {
    try {
      await persistArticleCategories(
        a,
        { title: a.title, snippet: a.snippet, language: a.language },
        { force: true }
      );
      ok++;
    } catch (e) {
      fail++;
      logger.warn("Recategorize failed", { id: a.id, error: e.message });
    }
  }
  logger.info("Done", { ok, fail });
}

main().catch((e) => {
  logger.error("Fatal", { error: e.message });
  process.exit(1);
});
