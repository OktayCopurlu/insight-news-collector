import {
  selectRecords,
  insertRecord,
  updateRecord,
} from "../config/database.js";
import { supabase } from "../config/database.js";
import { enhanceArticle, categorizeArticle } from "./gemini.js";
import { fetchAndExtract } from "./htmlExtractor.js";
import { createContextLogger } from "../config/logger.js";
import { generateContentHash } from "../utils/helpers.js";
import { logLLMEvent } from "../utils/llmLogger.js";

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

    if (existingArticles.length > 0) {
      logger.debug("Article already exists", {
        articleId: existingArticles[0].id,
        contentHash: articleData.content_hash,
      });
      // Ensure it has a score (populate if missing)
      try {
        const existingScore = await selectRecords("article_scores", {
          article_id: existingArticles[0].id,
        });
        if (existingScore.length === 0) {
          calculateArticleScore(existingArticles[0]).catch((e) =>
            logger.warn("Score calc failed (existing)", {
              articleId: existingArticles[0].id,
              error: e.message,
            })
          );
        }
      } catch (e) {
        logger.warn("Score presence check failed", {
          articleId: existingArticles[0].id,
          error: e.message,
        });
      }
      return existingArticles[0];
    }

    // (Optional) enforce full text requirement before persisting
    const requireFull =
      (process.env.REQUIRE_FULLTEXT || "true").toLowerCase() === "true";
    let preExtractedFullText = null;
    if (requireFull && process.env.ENABLE_HTML_EXTRACTION === "true") {
      try {
        const extracted = await fetchAndExtract(
          articleData.canonical_url || articleData.url
        );
        preExtractedFullText = extracted?.text || null;
        const tooShort = extracted?.diagnostics?.tooShort;
        if (!preExtractedFullText || tooShort) {
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
          } catch (_) {}
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
          } catch (_) {}
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
      if (/full_text/.test(e.message || "")) {
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

    // Process AI enhancement asynchronously (pass preExtractedFullText to avoid refetch)
    processArticleAI(article, { preExtractedFullText }).catch((error) => {
      logger.error("AI processing failed", {
        articleId: article.id,
        error: error.message,
      });
    });

    // Calculate article score asynchronously
    calculateArticleScore(article).catch((e) =>
      logger.warn("Score calc failed (new)", {
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

export const processArticleAI = async (article, options = {}) => {
  try {
    logger.debug("Processing AI enhancement", { articleId: article.id });

    // Check if AI processing already exists
    const existingAI = await selectRecords("article_ai", {
      article_id: article.id,
      is_current: true,
    });

    if (existingAI.length > 0) {
      logger.debug("AI enhancement already exists", { articleId: article.id });
      return existingAI[0];
    }

    // Optionally fetch full HTML content for richer AI context
    let fullText = options.preExtractedFullText || null;
    if (!fullText && process.env.ENABLE_HTML_EXTRACTION === "true") {
      const extracted = await fetchAndExtract(
        article.canonical_url || article.url
      );
      fullText = extracted?.text || null;
      if (fullText) {
        logger.debug("Full text extracted", {
          articleId: article.id,
          chars: fullText.length,
          strategy: extracted?.diagnostics?.strategy,
          tooShort: extracted?.diagnostics?.tooShort,
        });
        // Inline meta log for correlation without exposing full text
        try {
          const hash = generateContentHash(fullText).slice(0, 8);
          logLLMEvent({
            label: "fulltext_meta",
            prompt_hash: hash,
            model: "n/a",
            prompt: "meta only",
            response_raw: "",
            meta: {
              articleId: article.id,
              full_text_chars: fullText.length,
              strategy: extracted?.diagnostics?.strategy,
              http_status: extracted?.diagnostics?.httpStatus,
              content_type: extracted?.diagnostics?.contentType,
              initial_html_chars: extracted?.diagnostics?.initialHtmlChars,
              readability_chars: extracted?.diagnostics?.readabilityChars,
              selectors_chars: extracted?.diagnostics?.selectorsChars,
              jsonld_chars: extracted?.diagnostics?.jsonldChars,
              meta_desc_chars: extracted?.diagnostics?.metaDescChars,
              truncated: extracted?.diagnostics?.truncated,
              too_short: extracted?.diagnostics?.tooShort,
              paywall_suspect: extracted?.diagnostics?.paywallSuspect,
            },
          });
          if (
            (process.env.FULLTEXT_LOG_PREVIEW || "true").toLowerCase() ===
            "true"
          ) {
            const maxPreview = parseInt(
              process.env.FULLTEXT_LOG_PREVIEW_CHARS || "400"
            );
            const preview = fullText.slice(0, maxPreview);
            logLLMEvent({
              label: "fulltext_preview",
              prompt_hash: hash,
              model: "n/a",
              prompt: "preview",
              response_raw: preview,
              meta: {
                articleId: article.id,
                preview_chars: preview.length,
                total_chars: fullText.length,
              },
            });
          }
        } catch (e) {
          logger.warn("Failed to log fulltext meta", {
            articleId: article.id,
            error: e.message,
          });
        }
      }
    }

    // Generate AI enhancement with optional full text
    const aiContent = await enhanceArticle(article, {
      fullText,
      detailBullets: 8,
    });

    // Mark previous AI records as not current
    await updatePreviousAIRecords(article.id);

    // Insert new AI record
    const aiRecord = await insertRecord("article_ai", {
      article_id: article.id,
      ai_title: aiContent.ai_title,
      ai_summary: aiContent.ai_summary,
      ai_details: aiContent.ai_details,
      ai_language: aiContent.ai_language,
      model: aiContent.model,
      prompt_hash: aiContent.prompt_hash,
      is_current: true,
    });

    logger.info("AI enhancement completed", {
      articleId: article.id,
      aiRecordId: aiRecord.id,
    });

    // Process categorization
    await processArticleCategories(article);

    return aiRecord;
  } catch (error) {
    logger.error("AI processing failed", {
      articleId: article.id,
      error: error.message,
    });
    throw error;
  }
};

export const processArticleCategories = async (article) => {
  try {
    logger.debug("Processing article categorization", {
      articleId: article.id,
    });

    const categories = await categorizeArticle(article);

    for (const category of categories) {
      // Find or create category
      let categoryRecord = await selectRecords("categories", {
        path: category.path,
      });

      if (categoryRecord.length === 0) {
        categoryRecord = [
          await insertRecord("categories", { path: category.path }),
        ];
      }

      // Insert article-category relationship
      try {
        await insertRecord("article_categories", {
          article_id: article.id,
          category_id: categoryRecord[0].id,
          confidence: category.confidence,
        });
      } catch (error) {
        // Ignore duplicate key errors
        if (!error.message.includes("duplicate key")) {
          throw error;
        }
      }
    }

    logger.info("Article categorization completed", {
      articleId: article.id,
      categoryCount: categories.length,
    });
  } catch (error) {
    logger.error("Categorization failed", {
      articleId: article.id,
      error: error.message,
    });
    // Don't throw - categorization failure shouldn't stop article processing
  }
};

export const calculateArticleScore = async (article) => {
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

const updatePreviousAIRecords = async (articleId) => {
  try {
    const { error } = await supabase
      .from("article_ai")
      .update({ is_current: false })
      .eq("article_id", articleId)
      .eq("is_current", true);

    if (error) throw error;
  } catch (error) {
    logger.warn("Failed to update previous AI records", {
      articleId,
      error: error.message,
    });
  }
};

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

export const getArticlesNeedingAI = async (limit = 50) => {
  try {
    const { data, error } = await supabase.rpc("articles_needing_ai");

    if (error) throw error;

    return data.slice(0, limit);
  } catch (error) {
    logger.error("Failed to get articles needing AI", { error: error.message });
    return [];
  }
};
