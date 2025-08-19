import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { createContextLogger } from "../config/logger.js";
import { logLLMEvent, hashPrompt } from "../utils/llmLogger.js";

dotenv.config();

const logger = createContextLogger("GeminiService");

const genAI = new GoogleGenerativeAI(process.env.LLM_API_KEY);

export const generateAIContent = async (prompt, options = {}) => {
  const requested =
    options.maxOutputTokens || parseInt(process.env.LLM_MAX_TOKENS) || 800;
  const HARD_CAP = parseInt(process.env.LLM_MAX_TOKENS_CAP || "2048");
  const maxOutputTokens = Math.min(requested, HARD_CAP);
  const temperature = options.temperature || 0.7;
  const ATTEMPTS = options.attempts || 1;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: process.env.LLM_MODEL || "gemini-1.5-flash",
        generationConfig: { maxOutputTokens, temperature },
      });
      logger.debug("Generating AI content", {
        attempt,
        maxOutputTokens,
        temperature,
        promptLength: prompt.length,
      });
      const start = Date.now();
      const prompt_hash = hashPrompt(prompt);
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const durationMs = Date.now() - start;
      logger.info("AI content generated", {
        attempt,
        durationMs,
        responseLength: text.length,
      });
      logLLMEvent({
        label: "generation",
        prompt_hash,
        model: process.env.LLM_MODEL || "gemini-1.5-flash",
        max_tokens: maxOutputTokens,
        duration_ms: durationMs,
        prompt,
        response_raw: text,
        meta: { attempt, maxOutputTokens, temperature },
      });
      return text;
    } catch (error) {
      lastError = error;
      logger.warn("AI content generation attempt failed", {
        attempt,
        error: error.message,
      });
      if (attempt === ATTEMPTS) {
        logger.error("All AI generation attempts failed");
        throw error;
      }
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastError || new Error("Unknown AI generation failure");
};

export const categorizeArticle = async (article) => {
  try {
    const prompt = `
You are a news taxonomy classifier.

Task:
- Assign 1-3 hierarchical category paths (dot-separated) that best describe the article.
- Use concise, widely applicable taxonomy terms.
- Geographic categories follow this pattern: geo, geo.<country_code>, geo.<country_code>.<region_or_city>
  - <country_code> is ISO 3166-1 alpha-2 in lowercase (e.g., gb, ch, us).
- If the geography is unclear, use just "geo" or omit geo entirely.
- Return only a JSON array of {"path", "confidence"} objects. No extra text.

Examples:
[
  // Sports transfer
  {"path": "sports.football", "confidence": 0.9},
  {"path": "sports.football.transfer", "confidence": 0.8}
]

[
  // City-level event in Zurich, Switzerland
  {"path": "geo.ch", "confidence": 0.9},
  {"path": "geo.ch.zurich", "confidence": 0.8}
]

[
  // Macroeconomics in the United Kingdom
  {"path": "business.economy", "confidence": 0.85},
  {"path": "geo.gb", "confidence": 0.8}
]

Article:
Title: ${article.title}
Content: ${article.snippet}

Respond with JSON only (array of objects):
`;

    const response = await generateAIContent(prompt);

    try {
      const cleaned = cleanAIJSON(response);
      return JSON.parse(cleaned);
    } catch (parseError) {
      logger.warn("Failed to parse categorization response", {
        response: response.substring(0, 200),
      });
      return [{ path: "general", confidence: 0.5 }];
    }
  } catch (error) {
    logger.error("Failed to categorize article", {
      articleId: article.id,
      error: error.message,
    });
    return [{ path: "general", confidence: 0.5 }];
  }
};

// (removed) generatePromptHash was only used by the deleted enhanceArticle

// Attempt to strip markdown fences and extract JSON substring if surrounded by extra text
const cleanAIJSON = (raw) => {
  if (!raw) return raw;
  let text = raw.trim();
  // Remove ```json ... ``` or ``` fences
  if (text.startsWith("```")) {
    // remove first line fence
    text = text.replace(/^```[a-zA-Z0-9]*\n?/, "");
    // remove trailing fence
    text = text.replace(/```\s*$/, "");
  }
  text = text.trim();
  // If still not valid JSON, try to locate first { or [ and last } or ]
  if (!(text.startsWith("{") || text.startsWith("["))) {
    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");
    let start = -1;
    if (firstBrace !== -1 && firstBracket !== -1)
      start = Math.min(firstBrace, firstBracket);
    else start = firstBrace !== -1 ? firstBrace : firstBracket;
    if (start !== -1) text = text.slice(start);
  }
  // Trim after last closing
  const lastBrace = text.lastIndexOf("}");
  const lastBracket = text.lastIndexOf("]");
  let end = Math.max(lastBrace, lastBracket);
  if (end !== -1) text = text.slice(0, end + 1);
  return text.trim();
};
