import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createContextLogger } from "../config/logger.js";
import { normalizeBcp47 } from "../utils/lang.js";

const logger = createContextLogger("HtmlExtractor");

const MAX_FETCH_MS = parseInt(process.env.FETCH_TIMEOUT_MS) || 15000;
const MAX_CHARS = parseInt(process.env.HTML_EXTRACT_MAX_CHARS || "12000");
const MIN_USEFUL_CHARS = parseInt(process.env.HTML_EXTRACT_MIN_CHARS || "800");

// Utility: collapse whitespace & basic cleanup
function normalizeText(txt) {
  if (!txt) return "";
  return txt
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractJSONLD(doc) {
  const scripts = [
    ...doc.querySelectorAll('script[type="application/ld+json"]'),
  ];
  const bodies = [];
  for (const s of scripts) {
    try {
      const json = JSON.parse(s.textContent || "{}");
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item && typeof item === "object") {
          if (item.articleBody) bodies.push(item.articleBody);
          else if (item.description && item.description.length > 120)
            bodies.push(item.description);
        }
      }
    } catch (_) {
      // ignore parse errors intentionally
    }
  }
  const combined = bodies.join("\n\n");
  return normalizeText(combined);
}

function extractStructuredMeta(doc) {
  const ogDesc =
    doc
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content") || "";
  const metaDesc =
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
    "";
  let candidate = ogDesc.length > metaDesc.length ? ogDesc : metaDesc;
  candidate = normalizeText(candidate);
  return candidate;
}

function extractBySelectors(doc) {
  const containers = [];
  const SELECTORS = [
    "article",
    "main",
    "div[itemprop='articleBody']",
    "section[role='main']",
    "div[id*='article']",
    "div[class*='article']",
  ];
  for (const sel of SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) containers.push(el);
  }
  const paragraphs = [];
  containers.forEach((c) => {
    c.querySelectorAll("p").forEach((p) => {
      const t = normalizeText(p.textContent || "");
      if (t.length > 40) paragraphs.push(t);
    });
  });
  // Deduplicate successive duplicates
  const deduped = paragraphs.filter((p, i) => p && p !== paragraphs[i - 1]);
  return deduped.join("\n\n");
}

function pruneDOM(doc) {
  const REMOVE = [
    "script",
    "style",
    "noscript",
    "iframe",
    "header",
    "footer",
    "nav",
    "aside",
    "form",
  ].join(",");
  doc.querySelectorAll(REMOVE).forEach((n) => n.remove());
  // Remove comments
  const walker = doc.createTreeWalker(doc, 128 /* COMMENT_NODE */);
  const toRemove = [];
  while (walker.nextNode()) toRemove.push(walker.currentNode);
  toRemove.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
}

function extractPageLang(doc) {
  try {
    const rawLang =
      doc.documentElement.getAttribute("lang") ||
      doc.documentElement.getAttribute("xml:lang") ||
      "";
    const ogLocale =
      doc
        .querySelector('meta[property="og:locale"]')
        ?.getAttribute("content") || "";
    const httpLang =
      doc
        .querySelector('meta[http-equiv="content-language"]')
        ?.getAttribute("content") || "";
    const candidates = [rawLang, ogLocale, httpLang]
      .map((s) => (s || "").trim())
      .filter(Boolean);
    for (const c of candidates) {
      // og:locale uses underscores often (en_US)
      const norm = normalizeBcp47(c.replace(/_/g, "-"));
      if (norm) return norm;
    }
  } catch (_) {
    /* ignore lang extraction errors */
  }
  return null;
}

export async function fetchAndExtract(url) {
  const diagnostics = {
    url,
    strategy: null,
    httpStatus: null,
    contentType: null,
    initialHtmlChars: 0,
    mercuryChars: 0,
    readabilityChars: 0,
    selectorsChars: 0,
    jsonldChars: 0,
    metaDescChars: 0,
    finalChars: 0,
    truncated: false,
    tooShort: false,
    paywallSuspect: false,
  };
  try {
    // Helper to strip HTML tags from a string (simple)
    const stripHtml = (html) => (html || "").replace(/<[^>]+>/g, " ");

    // Strategy 0: Mercury Parser (fetches and parses remotely)
    // Enabled by default; disable with ENABLE_MERCURY_EXTRACTION=false
    if (
      (process.env.ENABLE_MERCURY_EXTRACTION || "true").toLowerCase() !==
      "false"
    ) {
      try {
        // dynamic import to play well with ESM/CJS interop
        const mod = await import("@postlight/mercury-parser");
        const Mercury = mod?.default || mod;
        if (Mercury && typeof Mercury.parse === "function") {
          const r = await Mercury.parse(url);
          const html = r?.content || "";
          const text = normalizeText(stripHtml(html));
          diagnostics.mercuryChars = text.length;
          if (text && text.length >= MIN_USEFUL_CHARS) {
            diagnostics.strategy = "mercury";
            if (text.length > MAX_CHARS) {
              diagnostics.truncated = true;
            }
            const trimmed = text.slice(0, MAX_CHARS);
            diagnostics.finalChars = trimmed.length;
            return {
              text: trimmed,
              title: r?.title || null,
              language: normalizeBcp47(r?.lang || r?.language || "") || null,
              diagnostics,
            };
          }
        }
      } catch (e) {
        logger.warn("Mercury parse failed, will fallback to local extraction", {
          url,
          error: e?.message || String(e),
        });
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_FETCH_MS);
    const resp = await axios.get(url, {
      timeout: MAX_FETCH_MS,
      responseType: "text",
      headers: {
        "User-Agent":
          process.env.FEED_USER_AGENT ||
          "InsightFeeder/1.0 (+https://example.com)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    clearTimeout(timer);
    diagnostics.httpStatus = resp.status;
    diagnostics.contentType = resp.headers["content-type"] || null;
    const html = resp.data || "";
    diagnostics.initialHtmlChars = html.length;

    const dom = new JSDOM(html, { url });
    pruneDOM(dom.window.document);
    const pageLang = extractPageLang(dom.window.document);

    // Strategy 1: Readability
    let bestText = "";
    const reader = new Readability(dom.window.document);
    let article;
    try {
      article = reader.parse();
    } catch (e) {
      article = null;
    }
    if (article && article.textContent) {
      bestText = normalizeText(article.textContent);
      diagnostics.readabilityChars = bestText.length;
      diagnostics.strategy = "readability";
    }

    // Strategy 2: JSON-LD articleBody
    const jsonLD = extractJSONLD(dom.window.document);
    diagnostics.jsonldChars = jsonLD.length;
    if (jsonLD.length > bestText.length * 1.1 && jsonLD.length > 400) {
      bestText = jsonLD;
      diagnostics.strategy = "jsonld";
    }

    // Strategy 3: Selector paragraphs
    const selectorText = extractBySelectors(dom.window.document);
    diagnostics.selectorsChars = selectorText.length;
    if (
      selectorText.length > bestText.length * 1.05 &&
      selectorText.length > 500
    ) {
      bestText = selectorText;
      diagnostics.strategy = "selectors";
    }

    // Strategy 4: Meta description fallback (short article only)
    const metaDesc = extractStructuredMeta(dom.window.document);
    diagnostics.metaDescChars = metaDesc.length;
    if (!bestText || bestText.length < 300) {
      if (metaDesc.length > bestText.length) {
        bestText = metaDesc;
        diagnostics.strategy = "meta";
      }
    }

    // Final normalisation & trimming
    if (bestText.length > MAX_CHARS) {
      bestText = bestText.slice(0, MAX_CHARS);
      diagnostics.truncated = true;
    }
    diagnostics.finalChars = bestText.length;
    diagnostics.tooShort = bestText.length < MIN_USEFUL_CHARS;
    diagnostics.paywallSuspect =
      /subscribe|sign in to read|trial access|©/.test(bestText.toLowerCase()) &&
      bestText.length < 1200;

    if (!bestText) {
      logger.warn("No extractable article text", { url });
      return null;
    }

    return {
      text: bestText,
      title: (article && article.title) || dom.window.document.title || null,
      language: pageLang || null,
      diagnostics,
    };
  } catch (err) {
    logger.warn("Failed to fetch/extract full article", {
      url,
      error: err.message,
    });
    return null;
  }
}

// Lightweight helper for the content pipeline: prefer structured HTML from Mercury
// and fall back to raw page HTML when Mercury is unavailable or too short.
// Returns: { html: string, language: string|null, strategy: 'mercury'|'raw' }
export async function fetchBestHtml(url) {
  // 1) Try Mercury content first (HTML)
  if (
    (process.env.ENABLE_MERCURY_EXTRACTION || "true").toLowerCase() !== "false"
  ) {
    try {
      const mod = await import("@postlight/mercury-parser");
      const Mercury = mod?.default || mod;
      if (Mercury && typeof Mercury.parse === "function") {
        const r = await Mercury.parse(url);
        const html = String(r?.content || "").trim();
        if (html && html.replace(/<[^>]+>/g, " ").trim().length >= 300) {
          return {
            html,
            language: normalizeBcp47(r?.lang || r?.language || "") || null,
            strategy: "mercury",
          };
        }
      }
    } catch (e) {
      logger.warn(
        "Mercury parse failed in fetchBestHtml; will fallback to raw",
        {
          url,
          error: e?.message || String(e),
        }
      );
    }
  }
  // 2) Fallback to raw HTML fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_FETCH_MS);
    const resp = await axios.get(url, {
      timeout: MAX_FETCH_MS,
      responseType: "text",
      headers: {
        "User-Agent":
          process.env.FEED_USER_AGENT ||
          "InsightFeeder/1.0 (+https://example.com)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    clearTimeout(timer);
    const html = String(resp.data || "");
    let language = null;
    try {
      const dom = new JSDOM(html, { url });
      language = extractPageLang(dom.window.document);
      dom.window.close();
    } catch (_) {
      /* ignore */
    }
    return { html, language, strategy: "raw" };
  } catch (e) {
    logger.warn("Raw HTML fetch failed in fetchBestHtml", {
      url,
      error: e?.message || String(e),
    });
    return { html: "", language: null, strategy: "raw" };
  }
}
