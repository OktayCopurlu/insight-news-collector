import { supabase } from "../config/database.js";
import { createContextLogger } from "../config/logger.js";
import { translateFields, translationMetrics } from "./translationHelper.js";
import { normalizeBcp47 } from "../utils/lang.js";

const logger = createContextLogger("ArticlePretranslator");

export async function runArticlePretranslationCycle(options = {}) {
  const {
    limit = parseInt(process.env.ARTICLE_PRETRANS_LIMIT || "100", 10),
    targetLangs = String(process.env.ARTICLE_PRETRANS_LANGS || "")
      .split(",")
      .map((l) => normalizeBcp47(l))
      .filter(Boolean),
  } = options;

  if (!targetLangs.length) {
    logger.info("No target languages configured; skip article pretranslation");
    return { checked: 0, inserted: 0 };
  }

  // Fetch recent articles with full_text
  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, language, title, snippet, full_text, created_at")
    .not("full_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  let processed = 0;
  const callsBefore = translationMetrics.providerCalls || 0;
  for (const a of articles || []) {
    const srcLang = normalizeBcp47(a.language || "auto");
    for (const dst of targetLangs) {
      if (!dst || dst === srcLang) continue;

      const { title, summary, details } = await translateFields(
        {
          title: a.title || "",
          summary: a.snippet || "",
          details: a.full_text || "",
        },
        { srcLang, dstLang: dst }
      );
      // translateFields persists per-field rows in the key-based `translations` cache table.
      // Count this pair as processed (cache warmed or already present).
      if (title || summary || details) processed += 1;
    }
  }

  logger.info("Article pretranslation done", {
    checked: (articles || []).length,
    processed,
    providerCallsDelta: (translationMetrics.providerCalls || 0) - callsBefore,
    targetLangs,
  });
  return {
    checked: (articles || []).length,
    processed,
    providerCalls: (translationMetrics.providerCalls || 0) - callsBefore,
  };
}
