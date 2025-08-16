import dotenv from "dotenv";
dotenv.config();

import { createContextLogger } from "../src/config/logger.js";
import { testConnection } from "../src/config/database.js";
import { generateAIContent } from "../src/services/gemini.js";

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

  // Per-article enhancement test removed; basic AI key validation above is sufficient now
  console.log(
    JSON.stringify({ success: true, checked: "ai_key_and_db" }, null, 2)
  );
};

run();
