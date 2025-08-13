import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createContextLogger } from "../config/logger.js";

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
      // ignore parse errors
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

export async function fetchAndExtract(url) {
  const diagnostics = {
    url,
    strategy: null,
    httpStatus: null,
    contentType: null,
    initialHtmlChars: 0,
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
