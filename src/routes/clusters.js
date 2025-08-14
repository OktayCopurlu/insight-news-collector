import express from "express";
import { supabase, selectRecords } from "../config/database.js";
import { createContextLogger } from "../config/logger.js";

const router = express.Router();
const logger = createContextLogger("ClustersAPI");

// List cluster representatives (one row per cluster)
router.get("/reps", async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      order = "desc", // by last_seen
      lang = "en",
      includeAI = "true",
    } = req.query;

    let query = supabase
      .from("v_cluster_reps")
      .select("*")
      .order("last_seen", { ascending: order === "asc" })
      .range(
        parseInt(offset),
        parseInt(offset) + Math.min(parseInt(limit), 100) - 1
      );

    const { data, error } = await query;
    if (error) throw error;

    // Optionally fetch rep article and AI
    const clusterRows = data || [];
    const repIds = [
      ...new Set(clusterRows.map((r) => r.rep_article_id).filter(Boolean)),
    ];
    const clusterIds = [...new Set(clusterRows.map((r) => r.cluster_id))];

    let articlesMap = {};
    if (repIds.length) {
      const { data: articles, error: aErr } = await supabase
        .from("articles")
        .select(
          "id,title,snippet,source_id,language,published_at,canonical_url,url"
        )
        .in("id", repIds);
      if (aErr) throw aErr;
      articlesMap = Object.fromEntries((articles || []).map((a) => [a.id, a]));
    }

    let aiMap = {};
    if (includeAI !== "false" && clusterIds.length) {
      const { data: aiRows, error: aiErr } = await supabase
        .from("cluster_ai")
        .select(
          "cluster_id,ai_title,ai_summary,ai_details,lang,is_current,created_at"
        )
        .in("cluster_id", clusterIds)
        .eq("is_current", true)
        .eq("lang", lang);
      if (aiErr) throw aiErr;
      aiMap = Object.fromEntries((aiRows || []).map((r) => [r.cluster_id, r]));
    }

    res.json({
      success: true,
      count: clusterRows.length,
      data: clusterRows.map((r) => ({
        ...r,
        rep_article: articlesMap[r.rep_article_id] || null,
        ai: aiMap[r.cluster_id] || null,
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Failed to list cluster reps", { error: error.message });
    res.status(500).json({ success: false, error: "Failed to list clusters" });
  }
});

// Cluster detail: summary + timeline + articles
router.get("/:id", async (req, res) => {
  try {
    const clusterId = req.params.id;
    const { lang = "en", limit = 50, offset = 0 } = req.query;

    const clusters = await selectRecords("clusters", { id: clusterId });
    if (!clusters.length) {
      return res
        .status(404)
        .json({ success: false, error: "Cluster not found" });
    }

    // Current AI in lang
    const { data: aiRows, error: aiErr } = await supabase
      .from("cluster_ai")
      .select("*")
      .eq("cluster_id", clusterId)
      .eq("lang", lang)
      .eq("is_current", true)
      .limit(1);
    if (aiErr) throw aiErr;

    // Timeline updates (most recent first)
    const { data: updates, error: uErr } = await supabase
      .from("cluster_updates")
      .select(
        "id,article_id,happened_at,stance,claim,evidence,summary,source_id,lang,created_at"
      )
      .eq("cluster_id", clusterId)
      .order("happened_at", { ascending: false })
      .range(
        parseInt(offset),
        parseInt(offset) + Math.min(parseInt(limit), 200) - 1
      );
    if (uErr) throw uErr;

    // Articles in cluster
    const { data: articles, error: aErr } = await supabase
      .from("articles")
      .select(
        "id,title,snippet,source_id,language,published_at,canonical_url,url"
      )
      .eq("cluster_id", clusterId)
      .order("published_at", { ascending: false });
    if (aErr) throw aErr;

    res.json({
      success: true,
      data: {
        cluster: clusters[0],
        ai: aiRows?.[0] || null,
        updates: updates || [],
        articles: articles || [],
      },
    });
  } catch (error) {
    logger.error("Failed to get cluster detail", {
      id: req.params.id,
      error: error.message,
    });
    res
      .status(500)
      .json({ success: false, error: "Failed to get cluster detail" });
  }
});

// Cluster timeline only
router.get("/:id/updates", async (req, res) => {
  try {
    const clusterId = req.params.id;
    const { limit = 100, offset = 0 } = req.query;

    const { data, error } = await supabase
      .from("cluster_updates")
      .select(
        "id,article_id,happened_at,stance,claim,evidence,summary,source_id,lang,created_at"
      )
      .eq("cluster_id", clusterId)
      .order("happened_at", { ascending: false })
      .range(
        parseInt(offset),
        parseInt(offset) + Math.min(parseInt(limit), 500) - 1
      );
    if (error) throw error;

    res.json({ success: true, count: data?.length || 0, data: data || [] });
  } catch (error) {
    logger.error("Failed to get cluster updates", {
      id: req.params.id,
      error: error.message,
    });
    res
      .status(500)
      .json({ success: false, error: "Failed to get cluster updates" });
  }
});

export default router;
