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
  const def = 24;
  const arg = process.argv.find((a) => a.startsWith("--hours="));
  if (!arg) return def;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function strongDetect(text = "") {
  const arabic = (text.match(/[\u0600-\u06FF]/g) || []).length >= 5;
  // Turkish-specific (exclude ö, ü)
  const tr = (text.match(/[ğĞşŞıİçÇ]/g) || []).length >= 1;
  const deUmlaut = (text.match(/[äÄöÖüÜß]/g) || []).length >= 1;
  const deWords = /(\bder\b|\bdie\b|\bdas\b|\bund\b|\boder\b|\baber\b|\bmit\b|\bvon\b|\bfür\b)/i.test(text);
  if (arabic) return "ar";
  if (tr) return "tr";
  if (deUmlaut && deWords) return "de";
  return null;
}

async function backfill() {
  const hours = parseHoursArg();
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  console.log(`Scanning articles since ${sinceIso} ...`);

  // Fetch recent articles with full_text preview and language
  const { data: arts, error } = await sb
    .from("articles")
    .select("id, language, full_text, title")
    .gte("published_at", sinceIso)
    .limit(1000);
  if (error) throw error;

  let fixes = 0;
  for (const a of arts) {
    const guess = strongDetect((a.full_text || a.title || "").slice(0, 4000));
    if (!guess) continue;
    const lang = a.language || "";
  const mismatchArabic = guess === "ar" && !lang.startsWith("ar");
  const mismatchTurkish = guess === "tr" && lang !== "tr";
  const mismatchGerman = guess === "de" && lang !== "de";
  if (mismatchArabic || mismatchTurkish || mismatchGerman) {
      const { error: uerr } = await sb
        .from("articles")
        .update({ language: guess })
        .eq("id", a.id);
      if (uerr) {
        console.warn(`Failed to update ${a.id}:`, uerr.message);
      } else {
        fixes++;
      }
    }
  }
  console.log(`Language backfill complete. Updated: ${fixes}`);
}

backfill().catch((e) => {
  console.error("Backfill failed:", e.message);
  process.exit(1);
});
