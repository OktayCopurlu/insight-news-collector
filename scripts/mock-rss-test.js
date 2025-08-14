#!/usr/bin/env node
import dotenv from "dotenv";
import {
  supabase,
  insertRecord,
  selectRecords,
} from "../src/config/database.js";
import { processArticle } from "../src/services/articleProcessor.js";
import { generateContentHash } from "../src/utils/helpers.js";

dotenv.config();

async function ensureSource(id) {
  const existing = await selectRecords("sources", { id });
  if (existing.length) return id;
  await insertRecord("sources", {
    id,
    name: "Mock RSS Source",
    homepage: "https://example.com",
    country: "GB",
    lang: "en",
  });
  return id;
}

function makeItem({ url, title, snippet, language = "en", published_at }) {
  const content_hash = generateContentHash(title, snippet);
  return { url, title, snippet, language, published_at, content_hash };
}

async function upsertStubAIForMissing(articleIds) {
  for (const id of articleIds) {
    const { data: existing } = await supabase
      .from("article_ai")
      .select("id")
      .eq("article_id", id)
      .eq("is_current", true);
    if (existing && existing.length) continue;
    await insertRecord("article_ai", {
      article_id: id,
      ai_title: "AI title (stub)",
      ai_summary: "AI summary (stub)",
      ai_details: "• detail 1\n• detail 2",
      ai_language: "en",
      model: "stub",
      prompt_hash: "stub",
      is_current: true,
    });
  }
}

async function main() {
  // Ensure flags for this run
  process.env.ENABLE_HTML_EXTRACTION = "false";
  process.env.CLUSTERING_ENABLED = "true";

  const sourceId = "mock-rss-source";
  await ensureSource(sourceId);

  const baseTime = Date.now();
  const items = [
    makeItem({
      url: "https://example.com/a",
      title: "Breaking: Alpha signs deal",
      snippet: "Alpha completes agreement",
      published_at: new Date(baseTime).toISOString(),
    }),
    makeItem({
      url: "https://example.com/b",
      title: "Market reacts to Beta news",
      snippet: "Stocks up after announcement",
      published_at: new Date(baseTime + 1000).toISOString(),
    }),
    makeItem({
      url: "https://example.com/c",
      title: "Gamma denies merger rumors",
      snippet: "Company issues statement",
      published_at: new Date(baseTime + 2000).toISOString(),
    }),
    // Duplicate of the first (same title+snippet -> same content_hash)
    makeItem({
      url: "https://example.com/a-dup1",
      title: "Breaking: Alpha signs deal",
      snippet: "Alpha completes agreement",
      published_at: new Date(baseTime + 3000).toISOString(),
    }),
    makeItem({
      url: "https://example.com/a-dup2",
      title: "Breaking: Alpha signs deal",
      snippet: "Alpha completes agreement",
      published_at: new Date(baseTime + 4000).toISOString(),
    }),
  ];

  const results = [];
  for (const item of items) {
    const res = await processArticle(item, sourceId);
    results.push(res);
  }

  // Count unique inserted articles for this source
  const { data: articles, error: aerr } = await supabase
    .from("articles")
    .select("id, content_hash")
    .eq("source_id", sourceId);
  if (aerr) throw aerr;

  const uniqCount = new Set(articles.map((a) => a.content_hash)).size;
  const duplicatesCaught = items.length - uniqCount;

  // Ensure AI exists (stub if LLM disabled) and count
  await upsertStubAIForMissing(articles.map((a) => a.id));
  const { data: aiRows, error: aiErr } = await supabase
    .from("article_ai")
    .select("id")
    .in(
      "article_id",
      articles.map((a) => a.id)
    )
    .eq("is_current", true);
  if (aiErr) throw aiErr;
  const aiCount = aiRows ? aiRows.length : 0;

  // Output
  console.log("Input items:", items.length);
  console.log("Unique articles inserted:", uniqCount);
  console.log("AI generated (current) records:", aiCount);
  console.log("Duplicates detected (by content_hash):", duplicatesCaught);
}

main().catch((e) => {
  console.error("Mock RSS test failed:", e.message);
  process.exit(1);
});
