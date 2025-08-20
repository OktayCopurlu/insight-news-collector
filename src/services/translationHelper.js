// Minimal translation helper with idempotent cache and pluggable backends
// Non-breaking: if no provider is configured, returns null.

import crypto from "node:crypto";
import { createContextLogger } from "../config/logger.js";
import { selectRecords, upsertRecord } from "../config/database.js";
import { normalizeBcp47 } from "../utils/lang.js";

const logger = createContextLogger("TranslationHelper");

// In-memory LRU-ish cache (process scoped)
const memoryCache = new Map();
export const translationMetrics = {
  cacheHits: 0,
  cacheMisses: 0,
  providerCalls: 0,
  providerErrors: 0,
  providerLatencyMsTotal: 0,
  providerLatencySamples: 0,
  providerLatencyMsLast: 0,
  providerLatencyMsAvg: 0,
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
      const t0 = Date.now();
      const prompt = `Translate to ${dst}. Keep meaning, names, and terminology consistent.\n\nText:\n${text}`;
      // Keep token budget modest for translation to reduce latency/timeouts
      const out = await generateAIContent(prompt, {
        maxOutputTokens: 768,
        temperature: 0.2,
        attempts: 2,
      });
      const dt = Date.now() - t0;
      translationMetrics.providerLatencyMsLast = dt;
      translationMetrics.providerLatencyMsTotal += dt;
      translationMetrics.providerLatencySamples += 1;
      translationMetrics.providerLatencyMsAvg = Math.round(
        translationMetrics.providerLatencyMsTotal /
          Math.max(1, translationMetrics.providerLatencySamples)
      );
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
      await upsertRecord(
        "translations",
        {
          key,
          src_lang: src,
          dst_lang: dst,
          text: translated,
        },
        { onConflict: "key", ignoreDuplicates: true }
      );
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

  // Config for long-text handling
  const MT_CHUNK_MAX_CHARS = Math.max(
    500,
    parseInt(process.env.MT_CHUNK_MAX_CHARS || "2800", 10)
  );
  const MT_MAX_ARTICLE_CHARS = Math.max(
    5000,
    parseInt(process.env.MT_MAX_ARTICLE_CHARS || "50000", 10)
  );

  // Helper: chunk long text by paragraphs into groups not exceeding MT_CHUNK_MAX_CHARS
  function chunkByParagraphs(text, maxChars) {
    const paras = String(text || "").split(/\n{2,}/);
    const chunks = [];
    let buf = [];
    let size = 0;
    for (const p of paras) {
      const pLen = p.length;
      if (pLen === 0) continue;
      if (pLen > maxChars) {
        // Very long single paragraph: split by sentences/length
        const parts = p.split(/(?<=[.!?])\s+/);
        let sb = [];
        let sl = 0;
        for (const s of parts) {
          if (sl + (sl ? 1 : 0) + s.length > maxChars) {
            if (sb.length) chunks.push(sb.join(" "));
            sb = [s];
            sl = s.length;
          } else {
            if (sl) sb.push(s);
            else sb = [s];
            sl += (sl ? 1 : 0) + s.length;
          }
        }
        if (sb.length) chunks.push(sb.join(" "));
        continue;
      }
      if (size + (size ? 2 : 0) + pLen > maxChars) {
        if (buf.length) chunks.push(buf.join("\n\n"));
        buf = [p];
        size = pLen;
      } else {
        if (size) buf.push(p);
        else buf = [p];
        size += (size ? 2 : 0) + pLen;
      }
    }
    if (buf.length) chunks.push(buf.join("\n\n"));
    return chunks;
  }

  async function translateLongDetails(text, { src, dst }) {
    const clean = (v) => (v || "").trim();
    const body = clean(text);
    if (!body) return "";
    if (body.length > MT_MAX_ARTICLE_CHARS) {
      // Too long — skip pretranslation; caller will decide to skip insert
      return "";
    }
    const parts = chunkByParagraphs(body, MT_CHUNK_MAX_CHARS);
    const out = [];
    for (const part of parts) {
      // Use per-string cached translate for each part
      // If provider missing, this returns null leading to fallback
      // We keep sequential to respect provider rate limits
      const t = await translateText(part, { srcLang: src, dstLang: dst });
      out.push((t || "").trim());
    }
    // Join with blank lines to preserve paragraphs
    return out.filter(Boolean).join("\n\n").trim();
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

  // If details is very long, handle it separately via chunking to avoid model limits
  const needsChunkedDetails = (details || "").length > MT_CHUNK_MAX_CHARS;
  if (needsChunkedDetails) {
    // Translate title/summary via per-string path (fast + cached), and details via chunking
    const [tt, ss, dd] = await Promise.all([
      title ? translateText(title, { srcLang: src, dstLang: dst }) : "",
      summary ? translateText(summary, { srcLang: src, dstLang: dst }) : "",
      translateLongDetails(details, { src, dst }),
    ]);
    // Persist per-field caches are handled inside translateText; for chunked details, each chunk was cached
    return {
      title: String(tt || title || "").trim(),
      summary: String(ss || summary || "").trim(),
      details: String(dd || "").trim(),
    };
  }

  // Provider single-call path (for shorter details)
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
      maxOutputTokens: 768,
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
        await upsertRecord(
          "translations",
          {
            key: k,
            src_lang: src,
            dst_lang: dst,
            text: translated,
          },
          { onConflict: "key", ignoreDuplicates: true }
        );
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
