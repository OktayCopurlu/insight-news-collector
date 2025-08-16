#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurable via env
const LOG_DIR = process.env.LLM_LOG_DIR || "llm-logs";
const PURGE = process.argv.includes("--purge");
const MAX_FILES = parseInt(process.env.LLM_LOG_MAX_FILES || "600");
const MAX_DAYS = parseInt(process.env.LLM_LOG_MAX_DAYS || "3"); // days retention

function human(n) {
  return n.toLocaleString();
}

const dir = path.resolve(process.cwd(), LOG_DIR);
if (!fs.existsSync(dir)) {
  console.log(`No log dir '${dir}' present.`);
  process.exit(0);
}

let files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
if (PURGE) {
  for (const f of files) {
    fs.unlinkSync(path.join(dir, f));
  }
  console.log(`Purged all ${files.length} log files.`);
  process.exit(0);
}
if (!files.length) {
  console.log("No log files to clean.");
  process.exit(0);
}

// Each file starts with ISO ts mutated (T and colons replaced). We'll parse back first portion.
function parseTs(name) {
  const isoPart = name.split("__")[0];
  // revert - in date/time separators to more ISO-like to parse forgivingly
  const _restored = isoPart.replace(/-/g, ":");
  // We replaced all dashes though; fallback to file mtime
  const stats = fs.statSync(path.join(dir, name));
  return stats.mtimeMs; // rely on mtime for simplicity / robustness
}

const now = Date.now();
const ageLimitMs = MAX_DAYS * 24 * 60 * 60 * 1000;

// Sort newest first
const withMeta = files
  .map((f) => ({ file: f, ts: parseTs(f) }))
  .sort((a, b) => b.ts - a.ts);

let removed = 0;
// Remove by age
for (const meta of withMeta) {
  if (now - meta.ts > ageLimitMs) {
    fs.unlinkSync(path.join(dir, meta.file));
    removed++;
  }
}
// Recompute list post age pruning
let remaining = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
if (remaining.length > MAX_FILES) {
  // remove oldest beyond MAX_FILES
  const sorted = remaining
    .map((f) => ({ f, ts: parseTs(f) }))
    .sort((a, b) => b.ts - a.ts);
  const excess = sorted.slice(MAX_FILES);
  for (const ex of excess) {
    fs.unlinkSync(path.join(dir, ex.f));
    removed++;
  }
  remaining = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
}

console.log(
  `LLM log cleanup complete. Removed ${human(removed)} files. Remaining ${human(
    remaining.length
  )}.`
);
console.log(
  `Retention constraints: max ${MAX_FILES} files, max ${MAX_DAYS} days.`
);
