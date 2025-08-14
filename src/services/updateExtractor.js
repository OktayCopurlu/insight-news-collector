import { createContextLogger } from "../config/logger.js";
import { generateAIContent } from "./gemini.js";

const logger = createContextLogger("UpdateExtractor");

// Optional heuristic rules (dev aid) — disabled by default via env flag
const EN_RULES = [
  {
    regex: /(reject|den(y|ied|ies)|refus|turns? down|pulls? out)/i,
    stance: "contradicts",
  },
  {
    regex: /(confirm|official|announce|signed|seal|complete)/i,
    stance: "supports",
  },
  {
    regex: /(agree|agreement|deal|terms|progress|advanced|close to|nears?)/i,
    stance: "supports",
  },
  { regex: /(rumor|speculat|report(s|ed)?|sources? say)/i, stance: "neutral" },
];

const TR_RULES = [
  { regex: /(reddetti|iptal|olumsuz|yalanlad[ıi])/i, stance: "contradicts" },
  {
    regex: /(resmi|açıkla(nd|d)[ıi]|anlaşt[ıi]|imzaland[ıi])/i,
    stance: "supports",
  },
  {
    regex: /(anlaşma|mutabakat|ileri|ilerliyor|yakın|yaklaşt[ıi])/i,
    stance: "supports",
  },
  { regex: /(iddia|söylenti|haberler[e]? göre)/i, stance: "neutral" },
];

function detectStanceHeuristic(title, lang) {
  const rules = (lang || "en").toLowerCase().startsWith("tr")
    ? TR_RULES
    : EN_RULES;
  for (const r of rules) if (r.regex.test(title || "")) return r.stance;
  return null;
}

function cleanClaim(title) {
  if (!title) return null;
  return title.replace(/[\s–—-]+$/g, "").trim();
}

export async function extractUpdateFromArticle(article) {
  try {
    const lang = article.language || "en";
    const claim = cleanClaim(article.title || article.snippet || "");
    const mode = (
      process.env.CLUSTER_UPDATE_STANCE_MODE || "off"
    ).toLowerCase();
    let stance = null;

    if (mode === "llm") {
      // Lightweight LLM classification (JSON) — optional and rate-limited by caller
      try {
        // Synchronous call kept minimal by token cap; if this becomes hot, move to async pipeline
        const prompt = buildStancePrompt(
          article.title || "",
          article.snippet || "",
          lang
        );
        const text = await generateAIContent(prompt, {
          maxOutputTokens: parseInt(
            process.env.CLUSTER_UPDATE_STANCE_LLM_TOKENS || "120"
          ),
          temperature: 0.2,
          attempts: 1,
        });
        const parsed = safeParseJSON(text);
        if (parsed && typeof parsed.stance === "string") stance = parsed.stance;
      } catch (e) {
        logger.warn("LLM stance classification failed; defaulting", {
          error: e.message,
        });
      }
    } else if (
      (process.env.CLUSTER_UPDATE_RULES_ENABLED || "false").toLowerCase() ===
      "true"
    ) {
      stance = detectStanceHeuristic(article.title || "", lang) || "neutral";
    }

    const summary = article.snippet || null;
    const evidence = "reporting";
    return { claim, stance, summary, evidence, lang };
  } catch (e) {
    logger.warn("Failed to extract update from article", { error: e.message });
    return {
      claim: (article.title || "").slice(0, 200),
      stance: null,
      summary: (article.snippet || "").slice(0, 500),
      evidence: "reporting",
      lang: article.language || null,
    };
  }
}

function buildStancePrompt(title, snippet, lang) {
  return `Classify the stance of the headline toward the core claim. Output STRICT JSON only: {"stance":"supports|contradicts|neutral"}.

Language: ${lang}
Title: ${title}
Snippet: ${snippet}`;
}

function safeParseJSON(raw) {
  try {
    const cleaned = (raw || "")
      .trim()
      .replace(/^```(json)?\n?/i, "")
      .replace(/```\s*$/i, "");
    return JSON.parse(cleaned);
  } catch (_) {
    return null;
  }
}
