#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const articleId = process.argv[2];
  if (!articleId) {
    console.error("Usage: node scripts/verify-article-content.js <articleId>");
    process.exit(1);
  }

  const out = { articleId };
  // Article row
  const { data: art, error: aErr } = await supabase
    .from("articles")
    .select("id, title, language, full_text, cluster_id")
    .eq("id", articleId)
    .maybeSingle();
  if (aErr || !art) {
    console.error("Article not found", aErr?.message || "");
    process.exit(2);
  }
  out.article = {
    title: art.title,
    language: art.language,
    fullTextBytes: Buffer.byteLength(art.full_text || "", "utf8"),
    hasFullText: !!(art.full_text && art.full_text.length > 0),
    cluster_id: art.cluster_id || null,
  };

  // Translations for this article
  const { data: trans, error: tErr } = await supabase
    .from("translations")
    .select("key, dst_lang, text")
    .like("key", `article:${articleId}:%`);
  if (tErr) {
    console.error("Translations query failed", tErr.message);
    process.exit(3);
  }
  out.translations = (trans || []).map((r) => ({
    key: r.key,
    dst_lang: r.dst_lang,
    bytes: Buffer.byteLength(r.text || "", "utf8"),
  }));

  // Cluster AI
  if (art.cluster_id) {
    const { data: ai, error: cErr } = await supabase
      .from("cluster_ai")
      .select("lang, ai_title, ai_summary, ai_details, is_current")
      .eq("cluster_id", art.cluster_id)
      .eq("is_current", true);
    if (cErr) {
      console.error("cluster_ai query failed", cErr.message);
      process.exit(4);
    }
    out.cluster_ai = (ai || []).map((r) => ({
      lang: r.lang,
      titleLen: (r.ai_title || "").length,
      summaryLen: (r.ai_summary || "").length,
      detailsLen: (r.ai_details || "").length,
    }));
  } else {
    out.cluster_ai = [];
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("Verify failed:", e.message);
  process.exit(10);
});
