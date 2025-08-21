import express from "express";
import axios from "axios";
import { createHash } from "crypto";
import { createContextLogger } from "../config/logger.js";
import {
  processAndPersistArticle,
  loadDefaultTargetLangs,
} from "../services/content-pipeline.gemini.js";

const router = express.Router();
const logger = createContextLogger("ContentRoute");

// POST /api/content/process-article
// Body: { articleId, rawHtml, url, sourceLang, targetLangs }
router.post("/process-article", async (req, res) => {
  const { articleId, rawHtml, url, sourceLang, targetLangs } = req.body || {};
  if (!articleId) {
    return res
      .status(400)
      .json({ success: false, error: "articleId required" });
  }
  try {
    const result = await processAndPersistArticle({
      db: null, // use default supabase-backed client
      articleId,
      rawHtml: rawHtml || "",
      url: url || null,
      sourceLang: sourceLang || process.env.DEFAULT_SOURCE_LANG || "auto",
      targetLangs: Array.isArray(targetLangs) ? targetLangs : undefined,
    });
    res.json({ success: true, result });
  } catch (e) {
    logger.error("process-article failed", { error: e.message, articleId });
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/content/default-target-langs
router.get("/default-target-langs", async (_req, res) => {
  try {
    const langs = await loadDefaultTargetLangs();
    res.json({ success: true, langs });
  } catch (e) {
    logger.error("default-target-langs failed", { error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;

// POST /api/content/fetch-and-process
// Body: { url, articleId?, sourceLang?, targetLangs? }
// Bypasses legacy pipeline: fetches raw HTML from the URL and runs the Gemini pipeline directly.
router.post("/fetch-and-process", async (req, res) => {
  const { url, articleId, sourceLang, targetLangs } = req.body || {};
  if (!url)
    return res.status(400).json({ success: false, error: "url required" });
  const id =
    articleId ||
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
      articleId: id,
      rawHtml,
      url,
      sourceLang: sourceLang || process.env.DEFAULT_SOURCE_LANG || "auto",
      targetLangs: Array.isArray(targetLangs) ? targetLangs : undefined,
    });
    return res.json({ success: true, articleId: id, result });
  } catch (e) {
    logger.error("fetch-and-process failed", {
      error: e.message,
      url,
      articleId: id,
    });
    return res
      .status(500)
      .json({ success: false, error: e.message, articleId: id });
  }
});
