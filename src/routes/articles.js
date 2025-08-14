import express from "express";
import {
  selectRecords,
  insertRecord,
  updateRecord,
  supabase,
} from "../config/database.js";
import {
  processArticleAI,
  getArticlesNeedingAI,
} from "../services/articleProcessor.js";
import { createContextLogger } from "../config/logger.js";
import { searchRateLimit, aiRateLimit } from "../middleware/rateLimiter.js";

const router = express.Router();
const logger = createContextLogger("ArticlesAPI");

const MEDIA_BUCKET = process.env.MEDIA_STORAGE_BUCKET || "news-media";

async function buildMediaForArticle(articleId) {
  // Find linked media
  const { data: links, error: lErr } = await supabase
    .from("article_media")
    .select("article_id, media_id, role, position")
    .eq("article_id", articleId)
    .order("position", { ascending: true });
  if (lErr) throw lErr;
  if (!links || !links.length) return null;
  const link = links.find((l) => l.role === "thumbnail") || links[0];
  // Fetch media asset
  const { data: mediaRows, error: mErr } = await supabase
    .from("media_assets")
    .select("id,origin,url,storage_path,width,height,license,attribution,hash")
    .eq("id", link.media_id)
    .limit(1);
  if (mErr) throw mErr;
  const media = mediaRows && mediaRows[0];
  if (!media) return null;
  // Compute public URL priority: storage public URL if path exists else direct URL
  let url = media.url || null;
  if (media.storage_path) {
    try {
      const { data: pub } = supabase.storage
        .from(MEDIA_BUCKET)
        .getPublicUrl(media.storage_path);
      if (pub?.publicUrl) url = pub.publicUrl;
    } catch (_) {}
  }
  // Load variants
  const { data: vars, error: vErr } = await supabase
    .from("media_variants")
    .select("media_id,width,storage_path,public_url,bytes")
    .eq("media_id", media.id);
  if (vErr && !String(vErr.message || "").includes("relation")) throw vErr;
  const variants = (vars || [])
    .map((v) => {
      let vUrl = v.public_url || null;
      if (!vUrl && v.storage_path) {
        const { data: vPub } = supabase.storage
          .from(MEDIA_BUCKET)
          .getPublicUrl(v.storage_path);
        vUrl = vPub?.publicUrl || null;
      }
      return { width: v.width, url: vUrl, bytes: v.bytes };
    })
    .filter((v) => !!v.url);
  return {
    id: media.id,
    origin: media.origin,
    url,
    width: media.width,
    height: media.height,
    license: media.license,
    attribution: media.attribution,
    variants,
  };
}

// Search articles (must come before /:id route)
router.get("/search", searchRateLimit, async (req, res) => {
  try {
    const {
      q,
      source_id,
      category,
      language,
      limit = 50,
      offset = 0,
    } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Search query must be at least 2 characters",
      });
    }

    let query = supabase
      .from("v_articles_public")
      .select("*")
      .textSearch("title", q.trim())
      .order("published_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (source_id) {
      query = query.eq("source_id", source_id);
    }

    if (language) {
      query = query.eq("language", language);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
      total: count,
      query: q.trim(),
    });
  } catch (error) {
    logger.error("Article search failed", { error: error.message });
    res.status(500).json({
      success: false,
      error: "Search failed",
    });
  }
});

// Get articles needing AI processing
router.get("/ai/pending", async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const articles = await getArticlesNeedingAI(parseInt(limit));

    res.json({
      success: true,
      data: articles,
      count: articles.length,
    });
  } catch (error) {
    logger.error("Failed to get articles needing AI", { error: error.message });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve articles needing AI processing",
    });
  }
});

// Get article statistics overview
router.get("/stats/overview", async (req, res) => {
  try {
    const { data: totalCount } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true });

    const { data: recentCount } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .gte(
        "published_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );

    const { data: aiProcessedCount } = await supabase
      .from("article_ai")
      .select("article_id", { count: "exact", head: true })
      .eq("is_current", true);

    const stats = {
      total_articles: totalCount || 0,
      recent_articles_24h: recentCount || 0,
      ai_processed: aiProcessedCount || 0,
      ai_pending: Math.max(0, (totalCount || 0) - (aiProcessedCount || 0)),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Failed to get article stats", { error: error.message });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve article statistics",
    });
  }
});

// List AI enhancements (article_ai) with optional filters
router.get("/ai/enhancements", async (req, res) => {
  try {
    const {
      article_id,
      is_current = "true",
      limit = 50,
      offset = 0,
      since_hours, // e.g. 24 to get last 24h
      includeArticle, // if truthy, join basic article fields
      order = "desc",
    } = req.query;

    let query = supabase
      .from("article_ai")
      .select("*")
      .order("created_at", { ascending: order === "asc" })
      .range(
        parseInt(offset),
        parseInt(offset) + Math.min(parseInt(limit), 100) - 1
      );

    if (article_id) query = query.eq("article_id", article_id);
    if (is_current !== "any")
      query = query.eq("is_current", is_current === "true");
    if (since_hours) {
      const since = new Date(
        Date.now() - parseInt(since_hours) * 60 * 60 * 1000
      ).toISOString();
      query = query.gte("created_at", since);
    }

    const { data, error } = await query;
    if (error) throw error;

    let articlesMap = {};
    if (includeArticle && data.length) {
      const ids = [...new Set(data.map((r) => r.article_id))];
      const { data: articlesData, error: aErr } = await supabase
        .from("articles")
        .select("id,title,snippet,source_id,published_at,language")
        .in("id", ids);
      if (aErr) throw aErr;
      articlesMap = Object.fromEntries(articlesData.map((a) => [a.id, a]));
    }

    res.json({
      success: true,
      count: data.length,
      data: data.map((r) =>
        includeArticle
          ? { ...r, article: articlesMap[r.article_id] || null }
          : r
      ),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Failed to list AI enhancements", { error: error.message });
    res
      .status(500)
      .json({ success: false, error: "Failed to retrieve AI enhancements" });
  }
});

// Get full AI history for an article (all versions)
router.get("/:id/ai/history", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("article_ai")
      .select("*")
      .eq("article_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    logger.error("Failed to get AI history", {
      articleId: req.params.id,
      error: error.message,
    });
    res
      .status(500)
      .json({ success: false, error: "Failed to retrieve AI history" });
  }
});

// Get all articles with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const {
      source_id,
      category,
      language,
      limit = 50,
      offset = 0,
      sort = "published_at",
      order = "desc",
      includeMedia,
    } = req.query;

    const filters = {};
    if (source_id) filters.source_id = source_id;
    if (language) filters.language = language;

    const options = {
      orderBy: {
        column: sort,
        ascending: order === "asc",
      },
      limit: Math.min(parseInt(limit), 100), // Cap at 100
      offset: parseInt(offset),
    };

    const articles = await selectRecords("articles", filters, options);

    // Optionally attach media in batch
    let mediaMap = {};
    if (includeMedia && articles.length) {
      const ids = [...new Set(articles.map((a) => a.id))];
      // Fetch links
      const { data: links } = await supabase
        .from("article_media")
        .select("article_id, media_id, role, position")
        .in("article_id", ids)
        .order("position", { ascending: true });
      const bestByArticle = new Map();
      for (const l of links || []) {
        const cur = bestByArticle.get(l.article_id);
        if (!cur || l.role === "thumbnail") bestByArticle.set(l.article_id, l);
      }
      const mediaIds = [
        ...new Set(Array.from(bestByArticle.values()).map((l) => l.media_id)),
      ];
      if (mediaIds.length) {
        const { data: mediaRows } = await supabase
          .from("media_assets")
          .select("id,origin,url,storage_path,width,height,license,attribution")
          .in("id", mediaIds);
        const mediaById = Object.fromEntries(
          (mediaRows || []).map((m) => [m.id, m])
        );
        // variants
        const { data: vars, error: vErr } = await supabase
          .from("media_variants")
          .select("media_id,width,storage_path,public_url,bytes")
          .in("media_id", mediaIds);
        const variantsByMedia = {};
        if (!vErr || String(vErr.message || "").includes("relation")) {
          for (const v of vars || []) {
            if (!variantsByMedia[v.media_id]) variantsByMedia[v.media_id] = [];
            let vUrl = v.public_url || null;
            if (!vUrl && v.storage_path) {
              const { data: vPub } = supabase.storage
                .from(MEDIA_BUCKET)
                .getPublicUrl(v.storage_path);
              vUrl = vPub?.publicUrl || null;
            }
            if (vUrl)
              variantsByMedia[v.media_id].push({
                width: v.width,
                url: vUrl,
                bytes: v.bytes,
              });
          }
        }
        // build mediaMap by article
        for (const [aid, link] of bestByArticle.entries()) {
          const m = mediaById[link.media_id];
          if (!m) continue;
          let url = m.url || null;
          if (m.storage_path) {
            const { data: pub } = supabase.storage
              .from(MEDIA_BUCKET)
              .getPublicUrl(m.storage_path);
            if (pub?.publicUrl) url = pub.publicUrl;
          }
          mediaMap[aid] = {
            id: m.id,
            origin: m.origin,
            url,
            width: m.width,
            height: m.height,
            license: m.license,
            attribution: m.attribution,
            variants: variantsByMedia[m.id] || [],
          };
        }
      }
    }

    res.json({
      success: true,
      data: includeMedia
        ? articles.map((a) => ({ ...a, media: mediaMap[a.id] || null }))
        : articles,
      count: articles.length,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Failed to get articles", { error: error.message });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve articles",
    });
  }
});

// Get article by ID
router.get("/:id", async (req, res) => {
  try {
    const articles = await selectRecords("articles", { id: req.params.id });

    if (articles.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Article not found",
      });
    }

    const article = articles[0];

    // Get AI enhancement if available
    const aiEnhancements = await selectRecords("article_ai", {
      article_id: req.params.id,
      is_current: true,
    });

    // Get categories
    const { data: categories } = await supabase
      .from("article_categories")
      .select(
        `
        confidence,
        categories (
          path
        )
      `
      )
      .eq("article_id", req.params.id);

    const enrichedArticle = {
      ...article,
      ai_enhancement: aiEnhancements[0] || null,
      categories:
        categories?.map((c) => ({
          path: c.categories.path,
          confidence: c.confidence,
        })) || [],
    };

    if ((req.query.includeMedia || "").toString() === "true") {
      try {
        enrichedArticle.media = await buildMediaForArticle(article.id);
      } catch (e) {
        logger.warn("Failed to enrich media for article", {
          id: article.id,
          error: e.message,
        });
      }
    }

    res.json({
      success: true,
      data: enrichedArticle,
    });
  } catch (error) {
    logger.error("Failed to get article", {
      articleId: req.params.id,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve article",
    });
  }
});

// Get media (thumbnail + variants) for an article
router.get("/:id/media", async (req, res) => {
  try {
    const media = await buildMediaForArticle(req.params.id);
    if (!media) {
      return res.status(404).json({ success: false, error: "No media found" });
    }
    res.json({ success: true, data: media });
  } catch (error) {
    logger.error("Failed to get article media", {
      articleId: req.params.id,
      error: error.message,
    });
    res.status(500).json({ success: false, error: "Failed to retrieve media" });
  }
});

// Process AI enhancement for article
router.post("/:id/ai", aiRateLimit, async (req, res) => {
  try {
    const articles = await selectRecords("articles", { id: req.params.id });

    if (articles.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Article not found",
      });
    }

    const article = articles[0];

    // Check if AI processing already exists
    const existingAI = await selectRecords("article_ai", {
      article_id: req.params.id,
      is_current: true,
    });

    if (existingAI.length > 0) {
      return res.json({
        success: true,
        data: existingAI[0],
        message: "AI enhancement already exists",
      });
    }

    const aiResult = await processArticleAI(article);

    logger.info("AI processing completed", { articleId: req.params.id });

    res.json({
      success: true,
      data: aiResult,
    });
  } catch (error) {
    logger.error("AI processing failed", {
      articleId: req.params.id,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Failed to process AI enhancement",
    });
  }
});

export default router;
