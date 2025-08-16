import Parser from "rss-parser";
import axios from "axios";
import { createContextLogger } from "../config/logger.js";
import { generateContentHash } from "../utils/helpers.js";
import fs from "fs";
import path from "path";
import { normalizeBcp47 } from "../utils/lang.js";

const logger = createContextLogger("FeedParser");

const parser = new Parser({
  timeout: parseInt(process.env.FETCH_TIMEOUT_MS) || 15000,
  headers: {
    "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
  },
  // Capture common media-related fields
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["enclosure", "enclosures", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
      ["image", "image"],
    ],
  },
});

export const parseFeed = async (feedUrl, options = {}) => {
  try {
    logger.info("Parsing feed", { feedUrl });

    const axiosConfig = {
      timeout: parseInt(process.env.FETCH_TIMEOUT_MS) || 15000,
      headers: {
        "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
      },
    };

    // Add conditional headers if available
    if (options.lastEtag) {
      axiosConfig.headers["If-None-Match"] = options.lastEtag;
    }
    if (options.lastModified) {
      axiosConfig.headers["If-Modified-Since"] = options.lastModified;
    }

    const response = await axios.get(feedUrl, axiosConfig);

    // Check if content was modified
    if (response.status === 304) {
      logger.info("Feed not modified", { feedUrl });
      return { items: [], notModified: true };
    }

    const feed = await parser.parseString(response.data);

    // Optional raw RSS logging
    if ((process.env.RSS_LOG_ENABLED || "true").toLowerCase() === "true") {
      try {
        const dir = path.resolve(
          process.cwd(),
          process.env.RSS_LOG_DIR || "rss-logs"
        );
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const base = feedUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
        const file = path.join(dir, `${ts}__raw__${base}.xml`);
        fs.writeFileSync(
          file,
          response.data.slice(
            0,
            parseInt(process.env.RSS_LOG_MAX_BYTES || "500000")
          ),
          "utf8"
        );
      } catch (e) {
        logger.warn("Failed to write raw RSS log", {
          feedUrl,
          error: e.message,
        });
      }
    }

    const items = feed.items.map((item) => {
      const mediaCandidates = extractRssMediaCandidates(item);
      // language: prefer explicit hints; else heuristic with confidence
      let lang = item.isoLanguage || item.lang || null;
      if (!lang) {
        const dl = detectLanguageWithConfidence(
          item.title,
          item.contentSnippet || item.summary || item.description
        );
        lang = dl.confidence >= 0.25 ? dl.lang : "en";
      }
      return {
        title: item.title || "",
        url: item.link || item.guid || "",
        snippet: item.contentSnippet || item.summary || item.description || "",
        published_at: item.pubDate ? new Date(item.pubDate) : new Date(),
        language: normalizeBcp47(lang),
        content_hash: generateContentHash(item.title, item.contentSnippet),
        media_candidates: mediaCandidates,
      };
    });

    // Structured JSON log (metadata + normalized items only, no full raw) to aid debugging
    if ((process.env.RSS_LOG_ENABLED || "true").toLowerCase() === "true") {
      try {
        const dir = path.resolve(
          process.cwd(),
          process.env.RSS_LOG_DIR || "rss-logs"
        );
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const base = feedUrl.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
        const metaFile = path.join(dir, `${ts}__parsed__${base}.json`);
        const meta = {
          feedUrl,
          itemCount: items.length,
          etag: response.headers.etag,
          lastModified: response.headers["last-modified"],
          sampleItems: items.slice(0, 5).map((it) => ({
            title: it.title,
            language: it.language,
            published_at: it.published_at,
          })),
        };
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
      } catch (e) {
        logger.warn("Failed to write parsed RSS log", {
          feedUrl,
          error: e.message,
        });
      }
    }

    logger.info("Feed parsed successfully", {
      feedUrl,
      itemCount: items.length,
      etag: response.headers.etag,
      lastModified: response.headers["last-modified"],
    });

    return {
      items,
      etag: response.headers.etag,
      lastModified: response.headers["last-modified"],
      notModified: false,
    };
  } catch (error) {
    if (error.response?.status === 304) {
      return { items: [], notModified: true };
    }

    logger.error("Failed to parse feed", {
      feedUrl,
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
};

function extractRssMediaCandidates(item) {
  const urls = [];
  const add = (u) => {
    if (!u) return;
    try {
      const url = new URL(u).href;
      // basic filter: avoid svg/gif/data
      if (/\.svg(\?|#|$)/i.test(url)) return;
      if (/\.gif(\?|#|$)/i.test(url)) return;
      if (/^data:/i.test(url)) return;
      urls.push(url);
    } catch (_) {
      /* ignore JSON-LD parse errors */
    }
  };

  // enclosures
  if (Array.isArray(item.enclosures)) {
    for (const e of item.enclosures) {
      const type = (e?.type || e?.["@type"] || "").toLowerCase();
      if (!type || type.startsWith("image/")) add(e?.url || e?.href);
    }
  } else if (item.enclosure) {
    const e = item.enclosure;
    const type = (e?.type || "").toLowerCase();
    if (!type || type.startsWith("image/")) add(e?.url);
  }

  // media:content
  const mcs = item.mediaContent || item["media:content"];
  if (Array.isArray(mcs)) {
    for (const mc of mcs) {
      if (typeof mc === "string") add(mc);
      else add(mc?.url || mc?.href || mc?.$?.url);
    }
  } else if (mcs) {
    const mc = mcs;
    if (typeof mc === "string") add(mc);
    else add(mc?.url || mc?.href || mc?.$?.url);
  }

  // media:thumbnail
  const mts = item.mediaThumbnail || item["media:thumbnail"];
  if (Array.isArray(mts)) {
    for (const mt of mts) {
      if (typeof mt === "string") add(mt);
      else add(mt?.url || mt?.href || mt?.$?.url);
    }
  } else if (mts) {
    const mt = mts;
    if (typeof mt === "string") add(mt);
    else add(mt?.url || mt?.href || mt?.$?.url);
  }

  // Some feeds include <image><url>
  if (item.image) {
    if (typeof item.image === "string") add(item.image);
    else add(item.image?.url || item.image?.href);
  }

  // Unique
  return Array.from(new Set(urls));
}

export const validateFeedUrl = async (feedUrl) => {
  try {
    const response = await axios.head(feedUrl, {
      timeout: 5000,
      headers: {
        "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
      },
    });

    const contentType = response.headers["content-type"] || "";
    const isValidFeed =
      contentType.includes("xml") ||
      contentType.includes("rss") ||
      contentType.includes("atom");

    return {
      valid: isValidFeed,
      contentType,
      status: response.status,
    };
  } catch (error) {
    logger.warn("Feed validation failed", { feedUrl, error: error.message });
    return {
      valid: false,
      error: error.message,
    };
  }
};

const detectLanguageWithConfidence = (title = "", content = "") => {
  const raw = `${title} ${content}`;
  const text = raw.toLowerCase();

  // Strong signals first: Arabic script and Turkish diacritics
  const arabicChars = (raw.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars >= 5) return { lang: "ar", confidence: 1.0 };

  // Turkish-specific letters (exclude ö, ü which also appear in German)
  const trSpecific = (raw.match(/[ğĞşŞıİçÇ]/g) || []).length;
  if (trSpecific >= 1) return { lang: "tr", confidence: 0.95 };

  // Function words heuristic; exclude highly ambiguous tokens to reduce false positives
  const patterns = {
    en: /\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/g,
    es: /\b(el|la|los|las|y|o|pero|en|con|por|para)\b/g, // exclude 'de'
    fr: /\b(le|la|les|et|ou|mais|dans|sur|avec|par|pour)\b/g, // exclude 'de'
    de: /\b(der|die|das|und|oder|aber|in|auf|mit|von|für)\b/g,
    it: /\b(il|la|lo|gli|le|e|o|ma|in|su|con|per)\b/g, // exclude 'di'/'da'
    tr: /\b(ve|ile|ama|fakat|için|olarak|üzerine|göre|daha|değil|ancak|bir)\b/g,
  };

  const counts = {};
  const deUmlauts = (raw.match(/[äÄöÖüÜß]/g) || []).length;
  let maxMatches = 0;
  let detected = "en";
  Object.entries(patterns).forEach(([lang, pattern]) => {
    const matches = (text.match(pattern) || []).length;
    counts[lang] = matches;
    if (matches > maxMatches) {
      maxMatches = matches;
      detected = lang;
    }
  });
  // If German words are present and umlauts appear, favor de over tr when no Turkish-specific letters
  if (
    detected !== "de" &&
    trSpecific === 0 &&
    counts["de"] >= 2 &&
    deUmlauts >= 1
  ) {
    detected = "de";
    maxMatches = Math.max(maxMatches, counts["de"] + 1);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const confidence = Math.min(1, maxMatches / Math.max(3, total));
  return { lang: detected, confidence };
};

export const extractFeedMetadata = async (feedUrl) => {
  try {
    const feed = await parser.parseURL(feedUrl);

    return {
      title: feed.title || "",
      description: feed.description || "",
      link: feed.link || "",
      language: normalizeBcp47(
        feed.language ||
          detectLanguageWithConfidence(feed.title, feed.description).lang
      ),
      lastBuildDate: feed.lastBuildDate ? new Date(feed.lastBuildDate) : null,
      itemCount: feed.items?.length || 0,
    };
  } catch (error) {
    logger.error("Failed to extract feed metadata", {
      feedUrl,
      error: error.message,
    });
    throw error;
  }
};
