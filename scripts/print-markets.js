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
  const { data, error } = await sb
    .from("app_markets")
    .select("*")
    .order("id", { ascending: true });
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
