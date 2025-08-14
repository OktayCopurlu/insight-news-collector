// Minimal translation helper with idempotent cache and pluggable backends
// Non-breaking: if no provider is configured, returns null.

import crypto from "node:crypto";
import { createContextLogger } from "../config/logger.js";
import { selectRecords, insertRecord } from "../config/database.js";
import { normalizeBcp47 } from "../utils/lang.js";

const logger = createContextLogger("TranslationHelper");

// In-memory LRU-ish cache (process scoped)
const memoryCache = new Map();
export const translationMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  providerCalls: 0,
  providerErrors: 0,
};
const MAX_CACHE = parseInt(process.env.TRANSLATION_CACHE_MAX || "500");

function cacheKey(text, src, dst) {
  const h = crypto.createHash("sha1").update(`${src}|${dst}|${text}`).digest("hex");
  return `${src}->${dst}:${h}`;
}

function setCache(key, value) {
  if (memoryCache.size >= MAX_CACHE) {
    // drop oldest entry
    const first = memoryCache.keys().next().value;
    if (first) memoryCache.delete(first);
  }
  memoryCache.set(key, { value, ts: Date.now() });
}

export async function translateText(text, { srcLang, dstLang }) {
  if (!text || !dstLang) return null;
  const src = normalizeBcp47(srcLang || "auto");
  const dst = normalizeBcp47(dstLang);
  const key = cacheKey(text, src, dst);

  const cached = memoryCache.get(key);
  if (cached) {
    translationMetrics.cacheHits++;
    return cached.value;
  }
  translationMetrics.cacheMisses++;

  // Optional DB-backed cache (if translations table exists)
  try {
    const row = (await selectRecords("translations", { key }))[0];
    if (row && row.text) {
      setCache(key, row.text);
      return row.text;
    }
  } catch (_) {
    // table may not exist; ignore
  }

  // Provider selection (env)
  const provider = (process.env.MT_PROVIDER || "none").toLowerCase();
  let translated = null;
  try {
    if (provider === "none") {
      translated = null; // noop in environments without MT
    } else if (provider === "gemini") {
      translationMetrics.providerCalls++;
      const { generateAIContent } = await import("./gemini.js");
      const prompt = `Translate to ${dst}. Keep meaning, names, and terminology consistent.\n\nText:\n${text}`;
      const out = await generateAIContent(prompt, { maxOutputTokens: 2048, temperature: 0.2, attempts: 2 });
      translated = (out || "").trim();
    } else if (provider === "openai") {
      // placeholder; implement when available
      translated = null;
    }
  } catch (e) {
    translationMetrics.providerErrors++;
    logger.warn("MT provider failed", { provider, error: e.message });
    translated = null;
  }

  if (translated) {
    setCache(key, translated);
    try {
      await insertRecord("translations", { key, src_lang: src, dst_lang: dst, text: translated });
    } catch (_) {
      // ignore if table missing or unique conflict
    }
  }

  return translated;
}

export function clearTranslationCache() {
  memoryCache.clear();
}
