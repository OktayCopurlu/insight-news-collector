import dotenv from "dotenv";
dotenv.config();

import { createContextLogger } from "../src/config/logger.js";
import { testConnection, selectRecords } from "../src/config/database.js";
import { generateAIContent } from "../src/services/gemini.js";
import {
  getArticlesNeedingAI,
  processArticleAI,
} from "../src/services/articleProcessor.js";

const logger = createContextLogger("AITest");

const run = async () => {
  logger.info("Starting AI key validation test");
  if (!process.env.LLM_API_KEY) {
    logger.error("LLM_API_KEY is missing in environment");
    process.exit(1);
  }
  logger.info("Model config", {
    model: process.env.LLM_MODEL,
    maxTokens: process.env.LLM_MAX_TOKENS,
  });

  const prompt = 'Respond ONLY with this exact JSON: {"ok":true}';
  try {
    const response = await generateAIContent(prompt, { temperature: 0 });
    logger.info("Basic generateAIContent success", {
      raw: response.substring(0, 60),
    });
  } catch (e) {
    logger.error("Basic AI content generation failed", { error: e.message });
    process.exit(1);
  }

  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn(
      "Skipping article enhancement test due to DB connection failure"
    );
    process.exit(0);
  }

  let targetArticle = null;
  try {
    const needing = await getArticlesNeedingAI(1);
    if (needing.length > 0) {
      const articles = await selectRecords("articles", { id: needing[0].id });
      targetArticle = articles[0];
    } else {
      const latest = await selectRecords(
        "articles",
        {},
        { orderBy: { column: "published_at", ascending: false }, limit: 1 }
      );
      targetArticle = latest[0];
    }
  } catch (e) {
    logger.warn("Failed to locate article for enhancement test", {
      error: e.message,
    });
  }

  if (!targetArticle) {
    logger.warn("No article found to test enhancement; exiting");
    process.exit(0);
  }

  try {
    const ai = await processArticleAI(targetArticle);
    logger.info("Article AI enhancement succeeded", {
      articleId: targetArticle.id,
      aiId: ai.id,
    });
    console.log(
      JSON.stringify(
        { success: true, articleId: targetArticle.id, aiId: ai.id },
        null,
        2
      )
    );
  } catch (e) {
    logger.error("Article enhancement failed", {
      articleId: targetArticle.id,
      error: e.message,
    });
    console.log(
      JSON.stringify(
        { success: false, articleId: targetArticle.id, error: e.message },
        null,
        2
      )
    );
    process.exit(1);
  }
};

run();
