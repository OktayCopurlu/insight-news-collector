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
  const h = crypto
    .createHash("sha1")
    .update(`${src}|${dst}|${text}`)
    .digest("hex");
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
      // Keep token budget modest for translation to reduce latency/timeouts
      const out = await generateAIContent(prompt, {
        maxOutputTokens: 480,
        temperature: 0.2,
        attempts: 2,
      });
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
      await insertRecord("translations", {
        key,
        src_lang: src,
        dst_lang: dst,
        text: translated,
      });
    } catch (_) {
      // ignore if table missing or unique conflict
    }
  }

  return translated;
}

export function clearTranslationCache() {
  memoryCache.clear();
}

// NEW: translate multiple related fields in one provider call to cut cost/latency
// Accepts an object { title, summary, details } and returns translated fields.
// Behavior:
// - If all fields hit cache/DB, returns them without provider calls.
// - Otherwise, makes a single JSON-constrained provider call (Gemini) and
//   writes per-field caches and DB rows for future reuse.
// - On provider failure, falls back to per-string translateText for each field.
export async function translateFields(fields, { srcLang = "auto", dstLang }) {
  const src = normalizeBcp47(srcLang || "auto");
  const dst = normalizeBcp47(dstLang);
  const { title = "", summary = "", details = "" } = fields || {};
  // Fast path: nothing to translate
  if (!dst || (!title && !summary && !details)) {
    return { title, summary, details };
  }

  // Try in-memory and DB cache per field
  async function resolveCached(original) {
    if (!original) return "";
    const k = cacheKey(original, src, dst);
    const mem = memoryCache.get(k);
    if (mem?.value) return mem.value;
    try {
      const row = (await selectRecords("translations", { key: k }))[0];
      if (row?.text) {
        setCache(k, row.text);
        return row.text;
      }
    } catch (_) {
      // ignore (table might not exist)
    }
    return null;
  }

  const [tHit, sHit, dHit] = await Promise.all([
    resolveCached(title),
    resolveCached(summary),
    resolveCached(details),
  ]);
  const allHit =
    (title ? !!tHit : true) &&
    (summary ? !!sHit : true) &&
    (details ? !!dHit : true);
  if (allHit) {
    return {
      title: (tHit || title || "").trim(),
      summary: (sHit || summary || "").trim(),
      details: (dHit || details || "").trim(),
    };
  }

  // Provider single-call path
  try {
    const { generateAIContent } = await import("./gemini.js");
    const instruction = [
      `Translate the provided JSON fields from ${src} to ${dst}.`,
      `Preserve meaning, names, terminology; no added commentary.`,
      `Return STRICT minified JSON with keys "title","summary","details" only.`,
      `Example: {"title":"...","summary":"...","details":"..."}`,
      `Input:`,
      JSON.stringify({ title, summary, details }),
    ].join("\n");
    const raw = await generateAIContent(instruction, {
      maxOutputTokens: 640,
      temperature: 0.2,
      attempts: 2,
    });
    // Minimal cleaning: strip code fences/backticks if present
    const cleaned = String(raw || "")
      .replace(/^```[a-zA-Z0-9]*\n?/, "")
      .replace(/```\s*$/, "")
      .trim();
    let obj = {};
    try {
      // Try parse; if fails, attempt to slice likely JSON substring
      obj = JSON.parse(cleaned);
    } catch (_) {
      const text = cleaned;
      const start = Math.min(
        ...["{", "["].map((ch) => {
          const i = text.indexOf(ch);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        })
      );
      const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      const slice =
        start !== Number.MAX_SAFE_INTEGER && end > start
          ? text.slice(start, end + 1)
          : "{}";
      try {
        obj = JSON.parse(slice);
      } catch {
        obj = {};
      }
    }
    const out = {
      title: String(obj.title ?? "").trim() || title,
      summary: String(obj.summary ?? "").trim() || summary,
      details: String(obj.details ?? "").trim() || details,
    };
    // Write back caches + DB rows per field
    const toPersist = [
      [title, out.title],
      [summary, out.summary],
      [details, out.details],
    ];
    for (const [orig, translated] of toPersist) {
      if (!orig || !translated) continue;
      const k = cacheKey(orig, src, dst);
      setCache(k, translated);
      try {
        await insertRecord("translations", {
          key: k,
          src_lang: src,
          dst_lang: dst,
          text: translated,
        });
      } catch (_) {
        // ignore unique constraint or missing table
      }
    }
    return out;
  } catch (_) {
    // Provider path failed — fallback to per-string
    const [tt, ss, dd] = await Promise.all([
      title
        ? translateText(title, { srcLang: src, dstLang: dst })
        : Promise.resolve(""),
      summary
        ? translateText(summary, { srcLang: src, dstLang: dst })
        : Promise.resolve(""),
      details
        ? translateText(details, { srcLang: src, dstLang: dst })
        : Promise.resolve(""),
    ]);
    return {
      title: String(tt || title || "").trim(),
      summary: String(ss || summary || "").trim(),
      details: String(dd || details || "").trim(),
    };
  }
}
