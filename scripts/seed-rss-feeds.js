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
  {
    id: "bbc-news",
    name: "BBC News",
    homepage: "https://www.bbc.com/news",
    country: "GB",
    lang: "en",
  },
  {
    id: "reuters",
    name: "Reuters",
    homepage: "https://www.reuters.com",
    country: "US",
    lang: "en",
  },
  {
    id: "guardian",
    name: "The Guardian",
    homepage: "https://www.theguardian.com",
    country: "GB",
    lang: "en",
  },
  {
    id: "al-jazeera",
    name: "Al Jazeera",
    homepage: "https://www.aljazeera.com",
    country: "QA",
    lang: "en",
  },
  {
    id: "npr",
    name: "NPR",
    homepage: "https://www.npr.org",
    country: "US",
    lang: "en",
  },
  {
    id: "sky-sports",
    name: "Sky Sports",
    homepage: "https://www.skysports.com",
    country: "GB",
    lang: "en",
  },
];

// Each feed: source_id, url, kind, section, country, lang
const feeds = [
  // BBC
  {
    source_id: "bbc-news",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    kind: "rss",
    section: "general",
    country: "GB",
    lang: "en",
  },
  {
    source_id: "bbc-news",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    kind: "rss",
    section: "world",
    country: "GB",
    lang: "en",
  },
  {
    source_id: "bbc-news",
    url: "https://feeds.bbci.co.uk/news/technology/rss.xml",
    kind: "rss",
    section: "technology",
    country: "GB",
    lang: "en",
  },
  // Reuters
  {
    source_id: "reuters",
    url: "https://www.reuters.com/rss/worldNews",
    kind: "rss",
    section: "world",
    country: "US",
    lang: "en",
  },
  {
    source_id: "reuters",
    url: "https://www.reuters.com/rss/technologyNews",
    kind: "rss",
    section: "technology",
    country: "US",
    lang: "en",
  },
  // Guardian
  {
    source_id: "guardian",
    url: "https://www.theguardian.com/world/rss",
    kind: "rss",
    section: "world",
    country: "GB",
    lang: "en",
  },
  {
    source_id: "guardian",
    url: "https://www.theguardian.com/uk/rss",
    kind: "rss",
    section: "uk",
    country: "GB",
    lang: "en",
  },
  {
    source_id: "guardian",
    url: "https://www.theguardian.com/technology/rss",
    kind: "rss",
    section: "technology",
    country: "GB",
    lang: "en",
  },
  // Al Jazeera
  {
    source_id: "al-jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    kind: "rss",
    section: "all",
    country: "QA",
    lang: "en",
  },
  // NPR
  {
    source_id: "npr",
    url: "https://feeds.npr.org/1001/rss.xml",
    kind: "rss",
    section: "top",
    country: "US",
    lang: "en",
  },
  {
    source_id: "npr",
    url: "https://feeds.npr.org/1004/rss.xml",
    kind: "rss",
    section: "world",
    country: "US",
    lang: "en",
  },
  // Sky Sports (football)
  {
    source_id: "sky-sports",
    url: "https://www.skysports.com/rss/12040",
    kind: "rss",
    section: "football",
    country: "GB",
    lang: "en",
  },
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
    // Check existing by url
    const { data: existing, error: selErr } = await sb
      .from("feeds")
      .select("id")
      .eq("url", feed.url)
      .limit(1);
    if (selErr) throw selErr;
    if (existing && existing.length) {
      continue;
    }
    const { error: insErr } = await sb
      .from("feeds")
      .insert({ ...feed, enabled: true });
    if (insErr) {
      // If duplicate arises due to race, ignore
      if (!/duplicate key/i.test(insErr.message)) {
        throw insErr;
      }
    } else {
      inserted++;
    }
  }
  console.log(`Feeds inserted (new): ${inserted}`);
}

(async () => {
  try {
    console.log("Seeding RSS sources & feeds...");
    await upsertSources();
    await upsertFeeds();
    console.log("Done. You can now run: npm run crawl");
  } catch (e) {
    console.error("Seed failed:", e.message);
    process.exit(1);
  }
})();
