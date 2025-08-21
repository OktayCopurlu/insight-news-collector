#!/usr/bin/env node
import dotenv from "dotenv";
import axios from "axios";
import { createHash } from "crypto";
import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";

dotenv.config();

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: node scripts/run-gemini-content-pipeline.js <url> [articleId]"
    );
    process.exit(1);
  }
  const articleId =
    process.argv[3] ||
    createHash("sha256").update(String(url)).digest("hex").slice(0, 16);
  try {
    const resp = await axios.get(url, {
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const rawHtml = String(resp.data || "");
    const result = await processAndPersistArticle({
      db: null,
      articleId,
      rawHtml,
      url,
      sourceLang: process.env.DEFAULT_SOURCE_LANG || "auto",
      targetLangs: (process.env.PRETRANSLATE_LANGS || "")
        .split(/[\s,]+/)
        .filter(Boolean),
    });
    console.log(JSON.stringify({ success: true, articleId, result }, null, 2));
  } catch (e) {
    console.error(
      JSON.stringify({ success: false, articleId, error: e.message }, null, 2)
    );
    process.exit(2);
  }
}

main();
