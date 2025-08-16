import express from "express";
import {
  selectRecords,
  insertRecord,
  updateRecord,
  supabase,
} from "../config/database.js";
import { createContextLogger } from "../config/logger.js";
import { isValidUrl } from "../utils/helpers.js";

const router = express.Router();
const logger = createContextLogger("SourcesAPI");

// Get all sources
router.get("/", async (req, res) => {
  try {
    const { country, lang } = req.query;
    const filters = {};

    if (country) filters.country = country;
    if (lang) filters.lang = lang;

    const sources = await selectRecords("sources", filters, {
      orderBy: { column: "name", ascending: true },
    });

    res.json({
      success: true,
      data: sources,
      count: sources.length,
    });
  } catch (error) {
    logger.error("Failed to get sources", { error: error.message });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve sources",
    });
  }
});

// Get source by ID
router.get("/:id", async (req, res) => {
  try {
    const sources = await selectRecords("sources", { id: req.params.id });

    if (sources.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Source not found",
      });
    }

    // Get associated feeds
    const feeds = await selectRecords("feeds", { source_id: req.params.id });

    const sourceWithFeeds = {
      ...sources[0],
      feeds,
    };

    res.json({
      success: true,
      data: sourceWithFeeds,
    });
  } catch (error) {
    logger.error("Failed to get source", {
      sourceId: req.params.id,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve source",
    });
  }
});

// Create new source
router.post("/", async (req, res) => {
  try {
    const {
      id,
      name,
      homepage,
      country,
      lang,
      terms_url,
      allowed_use,
      canonical_link_required,
    } = req.body;

    // Validation
    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: id, name",
      });
    }

    if (homepage && !isValidUrl(homepage)) {
      return res.status(400).json({
        success: false,
        error: "Invalid homepage URL format",
      });
    }

    if (terms_url && !isValidUrl(terms_url)) {
      return res.status(400).json({
        success: false,
        error: "Invalid terms URL format",
      });
    }

    // Check if source already exists
    const existingSources = await selectRecords("sources", { id });
    if (existingSources.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Source ID already exists",
      });
    }

    const source = await insertRecord("sources", {
      id,
      name,
      homepage: homepage || null,
      country: country || null,
      lang: lang || null,
      terms_url: terms_url || null,
      allowed_use: allowed_use || "link+snippet",
      canonical_link_required: canonical_link_required !== false,
    });

    logger.info("Source created", { sourceId: source.id, name });

    res.status(201).json({
      success: true,
      data: source,
    });
  } catch (error) {
    logger.error("Failed to create source", { error: error.message });
    res.status(500).json({
      success: false,
      error: "Failed to create source",
    });
  }
});

// Update source
router.put("/:id", async (req, res) => {
  try {
    const {
      name,
      homepage,
      country,
      lang,
      terms_url,
      allowed_use,
      canonical_link_required,
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (homepage !== undefined) {
      if (homepage && !isValidUrl(homepage)) {
        return res.status(400).json({
          success: false,
          error: "Invalid homepage URL format",
        });
      }
      updates.homepage = homepage;
    }
    if (country !== undefined) updates.country = country;
    if (lang !== undefined) updates.lang = lang;
    if (terms_url !== undefined) {
      if (terms_url && !isValidUrl(terms_url)) {
        return res.status(400).json({
          success: false,
          error: "Invalid terms URL format",
        });
      }
      updates.terms_url = terms_url;
    }
    if (allowed_use !== undefined) updates.allowed_use = allowed_use;
    if (canonical_link_required !== undefined)
      updates.canonical_link_required = canonical_link_required;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid fields to update",
      });
    }

    const source = await updateRecord("sources", req.params.id, updates);

    logger.info("Source updated", { sourceId: req.params.id });

    res.json({
      success: true,
      data: source,
    });
  } catch (error) {
    logger.error("Failed to update source", {
      sourceId: req.params.id,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to update source",
    });
  }
});

// Get source statistics
router.get("/:id/stats", async (req, res) => {
  try {
    const sourceId = req.params.id;

    // Get article count
    const { data: _articles, count: articleCount } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);

    // Get recent articles (last 24 hours)
    const { data: _recentArticles, count: recentCount } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId)
      .gte(
        "published_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );

    // Get feed count
    const feeds = await selectRecords("feeds", { source_id: sourceId });
    const enabledFeeds = feeds.filter((feed) => feed.enabled);

    // Get latest article
    const latestArticles = await selectRecords(
      "articles",
      { source_id: sourceId },
      {
        orderBy: { column: "published_at", ascending: false },
        limit: 1,
      }
    );

    const stats = {
      source_id: sourceId,
      total_articles: articleCount || 0,
      recent_articles_24h: recentCount || 0,
      total_feeds: feeds.length,
      enabled_feeds: enabledFeeds.length,
      latest_article: latestArticles[0] || null,
      feeds: feeds.map((feed) => ({
        id: feed.id,
        url: feed.url,
        enabled: feed.enabled,
        last_seen_at: feed.last_seen_at,
      })),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Failed to get source stats", {
      sourceId: req.params.id,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve source statistics",
    });
  }
});

export default router;
