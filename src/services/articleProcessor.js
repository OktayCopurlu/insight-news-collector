import {
  selectRecords,
  insertRecord,
  updateRecord,
} from "../config/database.js";
import { supabase } from "../config/database.js";
import { enhanceArticle, categorizeArticle } from "./gemini.js";
import { createContextLogger } from "../config/logger.js";
import { generateContentHash } from "../utils/helpers.js";

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
      return existingArticles[0];
    }

    // Create new article
    const article = await insertRecord("articles", {
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

    logger.info("Article created", {
      articleId: article.id,
      title: article.title?.substring(0, 50),
    });

    // Process AI enhancement asynchronously
    processArticleAI(article).catch((error) => {
      logger.error("AI processing failed", {
        articleId: article.id,
        error: error.message,
      });
    });

    return article;
  } catch (error) {
    logger.error("Failed to process article", {
      title: articleData.title?.substring(0, 50),
      error: error.message,
    });
    throw error;
  }
};

export const processArticleAI = async (article) => {
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

    // Generate AI enhancement
    const aiContent = await enhanceArticle(article);

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
