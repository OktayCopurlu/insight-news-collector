import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { createContextLogger } from "../config/logger.js";

dotenv.config();

const logger = createContextLogger("GeminiService");

const genAI = new GoogleGenerativeAI(process.env.LLM_API_KEY);

export const generateAIContent = async (prompt, options = {}) => {
  try {
    const model = genAI.getGenerativeModel({
      model: process.env.LLM_MODEL || "gemini-1.5-flash",
      generationConfig: {
        maxOutputTokens: parseInt(process.env.LLM_MAX_TOKENS) || 800,
        temperature: options.temperature || 0.7,
      },
    });

    logger.debug("Generating AI content", {
      model: process.env.LLM_MODEL,
      promptLength: prompt.length,
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    logger.info("AI content generated successfully", {
      responseLength: text.length,
    });

    return text;
  } catch (error) {
    logger.error("Failed to generate AI content", {
      error: error.message,
      promptLength: prompt.length,
    });
    throw error;
  }
};

export const enhanceArticle = async (article) => {
  try {
    const prompt = `
Analyze this news article and provide enhanced content in JSON format:

Title: ${article.title}
Snippet: ${article.snippet}
Language: ${article.language || "en"}

Please provide:
1. An improved, engaging title (ai_title)
2. A concise summary (ai_summary) - 2-3 sentences
3. Key details and context (ai_details) - bullet points of important information
4. Detected language code (ai_language)

Respond with valid JSON only:
{
  "ai_title": "Enhanced title here",
  "ai_summary": "Brief summary here",
  "ai_details": "• Key point 1\\n• Key point 2\\n• Key point 3",
  "ai_language": "en"
}
`;

    const response = await generateAIContent(prompt);

    try {
      const cleaned = cleanAIJSON(response);
      const parsed = JSON.parse(cleaned);
      return {
        ...parsed,
        model: process.env.LLM_MODEL || "gemini-1.5-flash",
        prompt_hash: generatePromptHash(prompt),
      };
    } catch (parseError) {
      logger.warn("Failed to parse AI response as JSON", {
        response: response.substring(0, 200),
      });

      // Fallback: extract content manually
      return {
        ai_title: article.title,
        ai_summary: article.snippet,
        ai_details: "AI enhancement failed - using original content",
        ai_language: article.language || "en",
        model: process.env.LLM_MODEL || "gemini-1.5-flash",
        prompt_hash: generatePromptHash(prompt),
      };
    }
  } catch (error) {
    logger.error("Failed to enhance article", {
      articleId: article.id,
      error: error.message,
    });
    throw error;
  }
};

export const categorizeArticle = async (article) => {
  try {
    const prompt = `
Categorize this news article. Choose the most relevant categories from this list:
- general
- sports
- sports.football
- sports.transfer
- geo
- geo.uk
- geo.uk.london

Article:
Title: ${article.title}
Content: ${article.snippet}

Respond with a JSON array of category paths with confidence scores (0-1):
[
  {"path": "sports.football", "confidence": 0.9},
  {"path": "geo.uk", "confidence": 0.7}
]
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

const generatePromptHash = (prompt) => {
  // Simple hash function for prompt tracking
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
};

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
