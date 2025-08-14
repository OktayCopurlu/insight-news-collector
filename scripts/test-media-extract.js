#!/usr/bin/env node
import { extractMetaImagesFromHtml } from "../src/services/mediaSelector.js";
import axios from "axios";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run media:test -- <article-url>");
    process.exit(1);
  }
  try {
    const resp = await axios.get(url, {
      timeout: parseInt(process.env.FETCH_TIMEOUT_MS || "15000"),
      headers: {
        "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
      },
    });
    const images = extractMetaImagesFromHtml(resp.data, url);
    console.log(
      JSON.stringify({ url, candidates: images.slice(0, 10) }, null, 2)
    );
  } catch (e) {
    console.error("Failed:", e.message);
    process.exit(2);
  }
}

main();
