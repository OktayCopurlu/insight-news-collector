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

function parseHoursArg() {
  const def = 2;
  const arg = process.argv.find((a) => a.startsWith("--hours="));
  if (!arg) return def;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

async function summary() {
  const hours = parseHoursArg();
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  console.log(`--- Language counts (last ${hours}h) ---`);
  console.log("--- Language counts (last 2h) ---");
  const { data: recent, error: e1 } = await sb
    .from("articles")
    .select("language")
    .gte("published_at", sinceIso);
  if (e1) throw e1;
  const counts = {};
  for (const r of recent) {
    const k = r.language || "unknown";
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(counts);

  console.log(`\n--- Clusters with >1 article (last ${hours}h) ---`);
  const { data: arts, error: e2 } = await sb
    .from("articles")
    .select("cluster_id")
    .not("cluster_id", "is", null)
    .gte("published_at", sinceIso);
  if (e2) throw e2;
  const cCounts = {};
  for (const a of arts) {
    cCounts[a.cluster_id] = (cCounts[a.cluster_id] || 0) + 1;
  }
  const multi = Object.entries(cCounts)
    .filter(([, n]) => n > 1)
    .slice(0, 20);
  console.log(multi);

  console.log(`\n--- Recent cluster_ai (pivot check, last ${hours}h) ---`);
  const { data: cai, error: e3 } = await sb
    .from("cluster_ai")
    .select("cluster_id, lang, is_current, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(20);
  if (e3) throw e3;
  console.table(cai);
}

summary().catch((e) => {
  console.error("Audit failed:", e.message);
  process.exit(1);
});
