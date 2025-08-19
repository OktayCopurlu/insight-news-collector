import { selectRecords, insertRecord, supabase } from "../config/database.js";
import { fetchAndExtract } from "./htmlExtractor.js";
import { normalizeBcp47 } from "../utils/lang.js";
import { createContextLogger } from "../config/logger.js";
import { generateContentHash } from "../utils/helpers.js";
import { logLLMEvent } from "../utils/llmLogger.js";
import { assignClusterForArticle } from "./clusterer.js";
import { selectAttachBestImage } from "./mediaSelector.js";
import { categorizeArticle } from "./gemini.js";

const logger = createContextLogger("ArticleProcessor");

export const processArticle = async (articleData, sourceId) => {
  try {
    logger.debug("Processing article", {
      title: articleData.title?.substring(0, 50),
      sourceId,
    });

    // Check if article already exists
    const existingArticles = await selectRecords("articles", {
      source_id: sourceId,
      content_hash: articleData.content_hash,
    });

    if (existingArticles.length > 0) return existingArticles[0];

    // (Optional) enforce full text requirement before persisting
    const requireFull = true; // strict: must have full text
    let preExtractedFullText = null;
    // Always attempt extraction if enabled (even if not strictly required)
    if (process.env.ENABLE_HTML_EXTRACTION === "true") {
      try {
        const extracted = await fetchAndExtract(
          articleData.canonical_url || articleData.url
        );
        preExtractedFullText = extracted?.text || null;
        // If page declares language, adopt when missing/auto or when strong mismatch suspected
        if (extracted?.language) {
          const normalized = normalizeBcp47(extracted.language);
          if (normalized) {
            const current = articleData.language || "";
            const isAuto = !current || current === "auto";
            const looksArabic = /[\u0600-\u06FF]/.test(
              preExtractedFullText || ""
            );
            // Turkish-specific letters only (exclude ö, ü as they appear in German)
            const hasTrSpecific = /[ğĞşŞıİçÇ]/.test(preExtractedFullText || "");
            const hasDeUmlaut = /[äÄöÖüÜß]/.test(preExtractedFullText || "");
            const deWords =
              /( der | die | das | und | oder | aber | mit | von | für )/i.test(
                ` ${preExtractedFullText || ""} `
              );
            const mismatchArabic =
              looksArabic && current && !current.startsWith("ar");
            const mismatchTurkish =
              hasTrSpecific && current && current !== "tr";
            const mismatchGerman =
              hasDeUmlaut && deWords && current && current !== "de";
            if (isAuto || mismatchArabic || mismatchTurkish) {
              articleData.language = normalized;
            }
            // If page-declared lang is de and content signals German, prefer de
            if (!isAuto && normalized === "de" && mismatchGerman) {
              articleData.language = "de";
            }
          }
        }
        const tooShort = extracted?.diagnostics?.tooShort;
        if (requireFull && (!preExtractedFullText || tooShort)) {
          logger.warn("Skipping article due to missing/short full text", {
            url: articleData.url,
            hasText: !!preExtractedFullText,
            tooShort,
          });
          try {
            logLLMEvent({
              label: "fulltext_skip",
              prompt_hash: generateContentHash(articleData.url).slice(0, 8),
              model: "n/a",
              prompt: "skip-meta",
              response_raw: "",
              meta: {
                url: articleData.url,
                reason: !preExtractedFullText ? "no_text" : "too_short",
                too_short: tooShort || false,
              },
            });
          } catch (_) {
            /* log best-effort event failure ignored */
          }
          return null; // signal skipped
        }
      } catch (e) {
        if (requireFull) {
          logger.warn("Skipping article due to extraction error", {
            url: articleData.url,
            error: e.message,
          });
          try {
            logLLMEvent({
              label: "fulltext_skip",
              prompt_hash: generateContentHash(articleData.url).slice(0, 8),
              model: "n/a",
              prompt: "skip-error",
              response_raw: "",
              meta: { url: articleData.url, reason: "error", error: e.message },
            });
          } catch (_) {
            /* log best-effort event failure ignored */
          }
          return null;
        }
      }
    }

    // Create new article (only after passing fulltext requirement if enforced)
    let article;
    try {
      article = await insertRecord("articles", {
        source_id: sourceId,
        url: articleData.url,
        canonical_url: articleData.canonical_url || articleData.url,
        title: articleData.title,
        snippet: articleData.snippet,
        language: articleData.language,
        published_at: articleData.published_at,
        content_hash: articleData.content_hash,
        fetched_at: new Date(),
        full_text: preExtractedFullText || null,
      });
    } catch (e) {
      if (/duplicate key value/.test(e.message || "")) {
        // Race condition: another worker inserted first. Fetch existing and continue.
        logger.debug("Duplicate detected on insert (race)", {
          url: articleData.url,
          contentHash: articleData.content_hash,
        });
        const raced = await selectRecords("articles", {
          source_id: sourceId,
          content_hash: articleData.content_hash,
        });
        if (raced.length) {
          article = raced[0];
        } else {
          throw e; // fallback - shouldn't happen
        }
      } else if (/full_text/.test(e.message || "")) {
        logger.warn("Insert without full_text (column missing)", {
          url: articleData.url,
          error: e.message,
        });
        article = await insertRecord("articles", {
          source_id: sourceId,
          url: articleData.url,
          canonical_url: articleData.canonical_url || articleData.url,
          title: articleData.title,
          snippet: articleData.snippet,
          language: articleData.language,
          published_at: articleData.published_at,
          content_hash: articleData.content_hash,
          fetched_at: new Date(),
        });
      } else {
        throw e;
      }
    }

    logger.info("Article created", {
      articleId: article.id,
      title: article.title?.substring(0, 50),
    });

    // Media selection & attachment (behind flags)
    try {
      await selectAttachBestImage(article);
    } catch (e) {
      logger.warn("Media selection failed (non-fatal)", {
        articleId: article.id,
        error: e.message,
      });
    }

    // Cluster assignment (stub) — only for new items; controlled by flag
    try {
      if (
        (process.env.CLUSTERING_ENABLED || "false").toLowerCase() === "true"
      ) {
        await assignClusterForArticle(article, { sourceId });
      }
    } catch (e) {
      logger.warn("Cluster assignment failed (non-fatal)", {
        articleId: article.id,
        error: e.message,
      });
    }

    // Calculate article score asynchronously
    calculateArticleScore(article).catch((e) =>
      logger.warn("Score calc failed (new)", {
        articleId: article.id,
        error: e.message,
      })
    );

    // Categorize article and persist links (non-blocking best-effort)
    persistArticleCategories(article, {
      title: article.title,
      snippet: article.snippet,
      language: article.language,
    }).catch((e) =>
      logger.warn("Categorization failed (non-fatal)", {
        articleId: article.id,
        error: e.message,
      })
    );

    return article;
  } catch (error) {
    logger.error("Failed to process article", {
      title: articleData.title?.substring(0, 50),
      error: error.message,
    });
    throw error;
  }
};

// processArticleAI removed — deprecated

// processArticleCategories removed (unused)

// Ensure category paths exist in DB (auto-create missing paths and parents)
async function ensureCategoryPaths(paths) {
  try {
    const enabled =
      (process.env.CATEGORIES_AUTO_CREATE || "true")
        .toString()
        .toLowerCase() !== "false";
    if (!enabled) return;
    const uniq = Array.from(new Set((paths || []).filter(Boolean)));
    if (!uniq.length) return;

    // Expand to include parent levels, e.g., sports.transfer -> ["sports", "sports.transfer"]
    const expand = (p) => {
      const parts = String(p).split(".").filter(Boolean);
      const acc = [];
      for (let i = 0; i < parts.length; i++)
        acc.push(parts.slice(0, i + 1).join("."));
      return acc;
    };
    const allLevelsSet = new Set();
    for (const p of uniq) expand(p).forEach((lv) => allLevelsSet.add(lv));
    const allLevels = Array.from(allLevelsSet);

    // Fetch existing
    let existing = [];
    try {
      const { data } = await supabase
        .from("categories")
        .select("path")
        .in("path", allLevels.length ? allLevels : ["__none__"]);
      existing = data || [];
    } catch (_) {
      // ignore fetch errors; we'll attempt inserts and rely on upsert conflicts to no-op
    }
    const have = new Set((existing || []).map((r) => r.path));
    const missing = allLevels.filter((p) => !have.has(p));
    if (!missing.length) return;

    // Build rows with parent_path
    const rows = missing.map((p) => ({
      path: p,
      parent_path: p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : null,
    }));
    // Upsert; ignore conflicts if created concurrently
    const { error: upErr } = await supabase
      .from("categories")
      .upsert(rows, { onConflict: "path" });
    if (upErr) throw upErr;
  } catch (e) {
    // Non-fatal; categorization continues without auto-create
    logger.warn("ensureCategoryPaths failed", { error: e.message });
  }
}
async function persistArticleCategories(article, minimal) {
  try {
    const enabled =
      (process.env.CATEGORIZATION_ENABLED || "true")
        .toString()
        .toLowerCase() !== "false";
    if (!enabled) return;

    // Skip if already categorized
    try {
      const existing = await selectRecords("article_categories", {
        article_id: article.id,
      });
      if (existing && existing.length) return;
    } catch (_) {
      /* ignore missing table or select failure; proceed to attempt insert */
    }

    // Ask LLM for categories; gemini helper will fallback to general on errors
    const suggestion = await categorizeArticle({
      id: article.id,
      title: minimal.title || "",
      snippet: minimal.snippet || "",
      language: minimal.language || "",
    });
    const cats = Array.isArray(suggestion) ? suggestion : [];
    if (!cats.length) return;
    const paths = [...new Set(cats.map((c) => c.path).filter(Boolean))];
    if (!paths.length) return;

    // Ensure taxonomy contains these paths (and parents)
    await ensureCategoryPaths(paths);

    // Map category paths to IDs (assume taxonomy seeded via migrations)
    const { data: catRows, error: catErr } = await supabase
      .from("categories")
      .select("id,path")
      .in("path", paths);
    if (catErr) throw catErr;
    const idByPath = new Map((catRows || []).map((r) => [r.path, r.id]));
    const records = [];
    for (const { path, confidence } of cats) {
      const id = idByPath.get(path);
      if (!id) continue; // skip unknown paths
      records.push({
        article_id: article.id,
        category_id: id,
        confidence:
          typeof confidence === "number" && confidence >= 0 && confidence <= 1
            ? confidence
            : 0.5,
      });
    }
    if (!records.length) return;
    // Upsert to avoid duplicate-key races on (article_id, category_id)
    const { error: upErr } = await supabase
      .from("article_categories")
      .upsert(records, { onConflict: "article_id,category_id" });
    if (upErr) throw upErr;
    logger.debug("Article categories persisted", {
      articleId: article.id,
      count: records.length,
    });
  } catch (error) {
    // Non-fatal; keep ingesting
    logger.warn("Article categorization skipped", {
      articleId: article?.id,
      error: error.message,
    });
  }
}

const calculateArticleScore = async (article) => {
  try {
    const factors = {
      recency: calculateRecencyScore(article.published_at),
      titleLength: calculateTitleScore(article.title),
      hasSnippet: article.snippet ? 1.0 : 0.0,
      sourceReliability: 0.7, // Default source reliability
    };

    const score =
      Object.values(factors).reduce((sum, factor) => sum + factor, 0) /
      Object.keys(factors).length;

    await insertRecord("article_scores", {
      article_id: article.id,
      score,
      factors,
    });

    logger.debug("Article score calculated", {
      articleId: article.id,
      score: score.toFixed(2),
    });

    return { score, factors };
  } catch (error) {
    logger.error("Score calculation failed", {
      articleId: article.id,
      error: error.message,
    });
    return { score: 0.5, factors: {} };
  }
};

// updatePreviousAIRecords removed — no longer relevant

export const calculateRecencyScore = (publishedAt) => {
  if (!publishedAt) return 0.5;

  const now = new Date();
  const published = new Date(publishedAt);
  const hoursDiff = (now - published) / (1000 * 60 * 60);

  if (hoursDiff < 1) return 1.0;
  if (hoursDiff < 6) return 0.9;
  if (hoursDiff < 24) return 0.7;
  if (hoursDiff < 72) return 0.5;
  return 0.3;
};

export const calculateTitleScore = (title) => {
  if (!title) return 0.0;

  const length = title.length;
  if (length < 20) return 0.3;
  if (length < 60) return 1.0;
  if (length < 100) return 0.8;
  return 0.6;
};

// getArticlesNeedingAI removed — per-article AI queue disabled
