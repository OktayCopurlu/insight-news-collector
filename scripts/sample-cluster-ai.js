#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing env var ${k}`);
    process.exit(1);
  }
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function fmt(s, n = 160) {
  if (!s) return "";
  const str = String(s).replace(/\n/g, " \u23CE ");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

async function run() {
  const lang = process.env.CLUSTER_LANG || "en";
  const { data, error } = await sb
    .from("cluster_ai")
    .select("cluster_id, lang, ai_title, ai_summary, ai_details, created_at")
    .eq("is_current", true)
    .eq("lang", lang)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;

  console.log(`Sample current cluster_ai in lang=${lang} (most recent first)`);
  for (const r of data || []) {
    const len = (r.ai_details || "").length;
    console.log(`\n- cluster ${r.cluster_id} | ${r.created_at}`);
    console.log(`  title:   ${fmt(r.ai_title, 140)}`);
    console.log(`  summary: ${fmt(r.ai_summary, 140)}`);
    console.log(`  details: ${len} chars | ${fmt(r.ai_details, 240)}`);
  }
}

run().catch((e) => {
  console.error("Sample failed:", e.message);
  process.exit(1);
});
