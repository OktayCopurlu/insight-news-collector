#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function upsertGlobalMarket({
  pivot = "en",
  show = ["en", "tr"],
  pretranslate = ["tr"],
} = {}) {
  // Attempt to upsert a 'global' market row; be resilient to schema differences and case of market_code
  const targetCode = "global";
  try {
    const { data: allRows, error: e0 } = await sb
      .from("app_markets")
      .select("*");
    if (e0) throw e0;
    const existing = (allRows || []).find(
      (r) => String(r.market_code || r.code || "").toLowerCase() === targetCode
    );
    if (!existing) {
      const record = {
        market_code: targetCode.toUpperCase(),
        pivot_lang: pivot,
        show_langs: show,
        pretranslate_langs: pretranslate,
        default_lang: pivot, // satisfy NOT NULL if present
        enabled: true,
      };
      const { error: insErr } = await sb
        .from("app_markets")
        .insert([record], { returning: "minimal" });
      if (insErr) throw insErr;
      console.log("Inserted app_markets.GLOBAL with langs", {
        pivot,
        show,
        pretranslate,
      });
      return;
    }
    const patch = { pivot_lang: pivot };
    if (existing.show_langs !== undefined) patch.show_langs = show;
    if (existing.pretranslate_langs !== undefined)
      patch.pretranslate_langs = pretranslate;
    if (existing.default_lang !== undefined && !existing.default_lang)
      patch.default_lang = pivot;
    const codeForUpdate = existing.market_code || existing.code || "GLOBAL";
    const { error: updErr } = await sb
      .from("app_markets")
      .update(patch)
      .eq("market_code", codeForUpdate);
    if (updErr) throw updErr;
    console.log("Updated app_markets.%s with langs", codeForUpdate, patch);
  } catch (e) {
    console.error("Failed to upsert app_markets:", e.message);
    process.exit(2);
  }
}

(async () => {
  const pivot = process.env.MARKET_PIVOT || "en";
  const show = (process.env.MARKET_SHOW || "en,tr")
    .split(/[\s,]+/)
    .filter(Boolean);
  const pretranslate = (process.env.MARKET_PRETRANSLATE || "tr,ar,fr,de")
    .split(/[\s,]+/)
    .filter(Boolean);
  await upsertGlobalMarket({ pivot, show, pretranslate });
})();
