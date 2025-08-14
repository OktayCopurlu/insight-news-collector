#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing env var ${k}`);
    process.exit(1);
  }
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const sources = [
  { id: "bbc-arabic", name: "BBC Arabic", homepage: "https://www.bbc.com/arabic", country: "GB", lang: "ar" },
  { id: "bbc-turkce", name: "BBC Türkçe", homepage: "https://www.bbc.com/turkce", country: "GB", lang: "tr" },
  { id: "tagesschau", name: "Tagesschau", homepage: "https://www.tagesschau.de/", country: "DE", lang: "de" },
  { id: "le-monde", name: "Le Monde", homepage: "https://www.lemonde.fr", country: "FR", lang: "fr" },
];

const feeds = [
  { source_id: "bbc-arabic", url: "https://feeds.bbci.co.uk/arabic/rss.xml", kind: "rss", section: "all", country: "GB", lang: "ar" },
  { source_id: "bbc-turkce", url: "https://feeds.bbci.co.uk/turkce/rss.xml", kind: "rss", section: "all", country: "GB", lang: "tr" },
  { source_id: "tagesschau", url: "https://www.tagesschau.de/xml/rss2", kind: "rss", section: "all", country: "DE", lang: "de" },
  { source_id: "le-monde", url: "https://www.lemonde.fr/rss/une.xml", kind: "rss", section: "une", country: "FR", lang: "fr" },
];

async function upsertSources() {
  const { data, error } = await sb
    .from("sources")
    .upsert(sources, { onConflict: "id" })
    .select("id");
  if (error) throw error;
  console.log(`Sources upserted: ${data.length}`);
}

async function upsertFeeds() {
  let inserted = 0;
  for (const feed of feeds) {
    const { data: existing, error: selErr } = await sb
      .from("feeds")
      .select("id")
      .eq("url", feed.url)
      .limit(1);
    if (selErr) throw selErr;
    if (existing && existing.length) continue;
    const { error: insErr } = await sb
      .from("feeds")
      .insert({ ...feed, enabled: true });
    if (insErr) {
      if (!/duplicate key/i.test(insErr.message)) throw insErr;
    } else {
      inserted++;
    }
  }
  console.log(`Feeds inserted (new): ${inserted}`);
}

(async () => {
  try {
    console.log("Seeding multi-language sources & feeds...");
    await upsertSources();
    await upsertFeeds();
    console.log("Done. You can now run a crawl.");
  } catch (e) {
    console.error("Seed failed:", e.message);
    process.exit(1);
  }
})();
