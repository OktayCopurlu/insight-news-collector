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

export const enhanceArticle = async (article, opts = {}) => {
  try {
    const detailBullets = opts.detailBullets || 8; // richer detail default now 8
    const fullText = opts.fullText;
    const MAX_FULL_TEXT = 8000; // hard cap tokens proxy (chars)
    const safeFull = fullText
      ? fullText.replace(/\s+/g, " ").slice(0, MAX_FULL_TEXT)
      : null;
    const contextBlock = safeFull
      ? `FullText: ${safeFull}`
      : `Snippet: ${article.snippet}`;
    const mode = (process.env.AI_DETAILS_MODE || "bullets").toLowerCase();
    let prompt;
    if (mode === "narrative") {
      const ctxLen = (safeFull || article.snippet || "").length;
      let wordRange;
      if (ctxLen < 1200) wordRange = "120-180";
      else if (ctxLen < 4000) wordRange = "220-360";
      else wordRange = "320-520";
      prompt = `You are an assistant turning a news article into an enriched factual narrative. Use ONLY information present in the provided text. No speculation. Return STRICT JSON only.

Title: ${article.title}
Language: ${article.language || "en"}
${contextBlock}

Requirements:
1. ai_title: Improved, engaging, <= 90 characters, factual (no clickbait, no exaggeration).
2. ai_summary: 2-3 sentences giving core who/what/when/why/impact.
3. ai_details: ${wordRange} word narrative in 2-4 short paragraphs (neutral journalistic style, no bullets, lists, section headers, or leading labels). Each paragraph 2-5 sentences. Cover when available: background/context, key actors & actions, mechanisms/causes, concrete impacts/stakes, next steps/outlook.
4. No sentence may repeat or trivially rephrase a prior sentence's core fact; each must add distinct information.
5. Do NOT fabricate names, numbers, or timelines not present. Avoid speculative modal verbs (might, could) unless present. No bullet characters (•, -, *).
6. ai_language: ISO 2-letter language code.

Output STRICT minified JSON only (no markdown fences): {"ai_title":"...","ai_summary":"...","ai_details":"Paragraph1\n\nParagraph2","ai_language":"en"}`;
    } else {
      prompt = `Analyze this news article and provide enhanced content in STRICT JSON (no prose outside JSON). Use ONLY facts present in the provided text. If information is absent, omit it instead of guessing.

Title: ${article.title}
Language: ${article.language || "en"}
${contextBlock}

Requirements:
1. ai_title: Improved, engaging, <= 90 characters, factual (no clickbait or hype words like "shocking").
2. ai_summary: 2-3 sentences, neutral tone (no opinion), must reference concrete facts from the text.
3. ai_details: ${detailBullets} bullet points using Unicode bullet • each. Cover (when available and factual): timeline, key actors, causes, mechanisms, implications/impact, risks/concerns, next steps/outlook, quantitative data. Each bullet <= 200 chars, no numbering, no duplication, no speculative language (avoid "might", "could" unless present in text). Do not invent data.
4. ai_language: ISO 2-letter language code of the source text.

Strict Output JSON only (minified, no markdown fences, no trailing commas): {"ai_title":"...","ai_summary":"...","ai_details":"• Bullet 1\n• Bullet 2","ai_language":"en"}`;
    }

    const response = await generateAIContent(prompt, {
      maxOutputTokens: opts.maxOutputTokens,
      temperature: mode === "narrative" ? 0.5 : opts.temperature || 0.7,
      attempts: 2,
    });

    try {
      const cleaned = cleanAIJSON(response);
      const parsed = JSON.parse(cleaned);
      // Enforce minimum narrative length if mode narrative and short; optional future retry logic
      if (mode === "narrative") {
        const wc = (parsed.ai_details || "")
          .split(/\s+/)
          .filter(Boolean).length;
        const minWords = 120; // lower band
        if (wc < minWords) {
          logger.warn("Narrative below minimum word count", {
            wc,
            minWords,
            articleId: article.id,
          });
          logLLMEvent({
            label: "narrative_short",
            prompt_hash: generatePromptHash(prompt),
            model: process.env.LLM_MODEL || "gemini-1.5-flash",
            prompt,
            response_raw: cleaned,
            meta: { word_count: wc, minWords },
          });
        }
      }
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
