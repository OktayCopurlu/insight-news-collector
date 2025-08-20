#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const main = async () => {
  // Some schemas may not have an 'id' column; avoid ordering by it.
  let q = sb.from("app_markets").select("*");
  const { data, error } = await q;
  if (error) throw error;
  // Try to provide stable order by market_code if present
  const sorted = [...(data || [])].sort((a, b) => {
    const am = (a.market_code || a.code || "").toString();
    const bm = (b.market_code || b.code || "").toString();
    return am.localeCompare(bm);
  });
  console.log(JSON.stringify(sorted, null, 2));
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
