#!/usr/bin/env node
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/ANON env vars"
  );
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function trunc(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

(async () => {
  try {
    const arts = await sb
      .from("articles")
      .select("id,title,language,full_text,created_at")
      .not("full_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    const totalArts = await sb
      .from("articles")
      .select("id", { count: "exact", head: true });

    const trans = await sb
      .from("translations")
      .select("key,src_lang,dst_lang", { count: "exact", head: false })
      .limit(20);

    const langs = new Map();
    for (const r of trans.data || []) {
      const k = (r.dst_lang || "").toLowerCase();
      langs.set(k, (langs.get(k) || 0) + 1);
    }

    console.log("Articles total:", totalArts.count ?? "?");
    console.log(
      "Articles with full_text (sample):",
      (arts.data || []).map((a) => ({
        id: a.id,
        lang: a.language,
        len: (a.full_text || "").length,
        title: trunc(a.title, 80),
      }))
    );
    console.log(
      "Translations total:",
      trans.count ?? (trans.data || []).length
    );
    console.log("Translations sample langs:", Object.fromEntries(langs));
    process.exit(0);
  } catch (e) {
    console.error("Verification failed:", e.message);
    process.exit(1);
  }
})();
