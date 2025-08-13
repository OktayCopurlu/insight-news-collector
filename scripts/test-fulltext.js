#!/usr/bin/env node
import dotenv from "dotenv";
import { fetchAndExtract } from "../src/services/htmlExtractor.js";
import { logLLMEvent } from "../src/utils/llmLogger.js";
import { generateContentHash } from "../src/utils/helpers.js";

dotenv.config();

// Usage: node scripts/test-fulltext.js <url1> <url2> ...
// Or provide a file with --file=urls.txt (one URL per line)

async function readUrlsFromArgs() {
  const args = process.argv.slice(2);
  let fileArg = args.find((a) => a.startsWith("--file="));
  let urls = args.filter((a) => !a.startsWith("--file="));
  if (fileArg) {
    const fs = await import("fs");
    const path = fileArg.split("=")[1];
    if (fs.existsSync(path)) {
      const lines = fs
        .readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      urls.push(...lines);
    } else {
      console.error("File not found:", path);
      process.exit(1);
    }
  }
  if (urls.length === 0) {
    console.error("Provide at least one URL or --file=urls.txt");
    process.exit(1);
  }
  return urls;
}

function summarize(text, max = 300) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "...";
}

async function main() {
  const urls = await readUrlsFromArgs();
  console.log(`Testing full-text extraction for ${urls.length} URL(s)\n`);
  for (const url of urls) {
    const start = Date.now();
    try {
      const result = await fetchAndExtract(url);
      const ms = Date.now() - start;
      if (!result) {
        console.log(`FAIL: ${url}\n  -> No extractable text`);
        logLLMEvent({
          label: "fulltext_failure",
          prompt_hash: generateContentHash(url).slice(0, 8),
          model: "n/a",
          prompt: "fetch-only",
          response_raw: "",
          meta: { url, duration_ms: ms, reason: "no_text" },
        });
        continue;
      }
      const { text, diagnostics } = result;
      const hash = generateContentHash(text).slice(0, 8);
      console.log(`OK: ${url}`);
      console.log(
        `  strategy=${diagnostics.strategy} chars=${text.length} http=${diagnostics.httpStatus} tooShort=${diagnostics.tooShort}`
      );
      if (diagnostics.paywallSuspect) console.log("  paywallSuspect=true");
      console.log(
        '  preview="' + summarize(text, 160).replace(/\n/g, " ") + '"'
      );
      logLLMEvent({
        label: "fulltext_manual",
        prompt_hash: hash,
        model: "n/a",
        prompt: "manual-test",
        response_raw: summarize(text, 1000),
        meta: {
          url,
          ...diagnostics,
          preview_chars: Math.min(text.length, 1000),
        },
      });
    } catch (e) {
      const ms = Date.now() - start;
      console.log(`ERROR: ${url}\n  -> ${e.message}`);
      logLLMEvent({
        label: "fulltext_failure",
        prompt_hash: generateContentHash(url).slice(0, 8),
        model: "n/a",
        prompt: "fetch-only",
        response_raw: "",
        meta: { url, duration_ms: ms, error: e.message },
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
