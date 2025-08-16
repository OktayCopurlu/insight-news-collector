#!/usr/bin/env node
import dotenv from "dotenv";
import { supabase, insertRecord, selectRecords } from "../src/config/database.js";
import { assignClusterForArticle } from "../src/services/clusterer.js";

dotenv.config();

async function ensureSource(id) {
  const existing = await selectRecords("sources", { id });
  if (existing.length) return id;
  await insertRecord("sources", {
    id,
    name: "Smoke Test Source",
    homepage: "https://example.com",
    country: "GB",
    lang: "en",
    terms_url: null,
  });
  return id;
}

async function main() {
  const sourceId = "smoke-source";
  await ensureSource(sourceId);

  // Insert a unique article
  const now = new Date().toISOString();
  const title = `Smoke Unique Story ${Date.now()}`;
  const content_hash = `hash_${Date.now()}`;
  const { data: ares, error: aerr } = await supabase
    .from("articles")
    .insert({
      source_id: sourceId,
      url: `https://example.com/${content_hash}`,
      canonical_url: null,
      title,
      snippet: "Short snippet",
      language: "en",
      published_at: now,
      fetched_at: now,
      content_hash,
      full_text: "Body of the article for similarity testing.",
    })
    .select()
    .single();
  if (aerr) throw aerr;

  // Try to assign cluster (should create new cluster for unique story)
  const clusterId1 = await assignClusterForArticle(ares, { sourceId });
  console.log("Cluster for first article:", clusterId1);

  // Insert a similar article (same title prefix) to test reuse
  const { data: bres, error: berr } = await supabase
    .from("articles")
    .insert({
      source_id: sourceId,
      url: `https://example.com/${content_hash}_b`,
      canonical_url: null,
      title: `${title} follow-up`,
      snippet: "Short snippet 2",
      language: "en",
      published_at: new Date(Date.now() + 1000).toISOString(),
      fetched_at: now,
      content_hash: `${content_hash}_b`,
      full_text: "Body of the article for similarity testing with follow-up.",
    })
    .select()
    .single();
  if (berr) throw berr;

  const clusterId2 = await assignClusterForArticle(bres, { sourceId });
  console.log("Cluster for second article:", clusterId2);

  // Inspect timeline for cluster
  const { data: updates, error: uerr } = await supabase
    .from("cluster_updates")
    .select("cluster_id, article_id, stance, claim, happened_at")
    .eq("cluster_id", clusterId1)
    .order("happened_at", { ascending: true });
  if (uerr) throw uerr;
  console.log("Timeline updates for cluster", clusterId1, updates);
}

main().catch((e) => {
  console.error("Smoke test failed:", e.message);
  process.exit(1);
});
