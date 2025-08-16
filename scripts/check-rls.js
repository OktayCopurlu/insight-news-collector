#!/usr/bin/env node
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const tables = (
  process.argv[2] || "media_assets,articles,sources,clusters,cluster_ai"
).split(",");

async function q(sql) {
  const { data, error } = await supabase.rpc("exec_sql", { sql });
  if (error) throw error;
  return data;
}

async function main() {
  for (const tbl of tables) {
    const t = tbl.trim();
    console.log(`\n--- ${t} ---`);
    try {
      const rls = await q(
        `select relrowsecurity as rls_enabled from pg_class where relname='${t.replace(
          /'/g,
          "''"
        )}'`
      );
      console.log("RLS:", rls?.[0] ?? "(n/a)");
    } catch (e) {
      console.log("RLS: error", e.message);
    }
    try {
      const policies = await q(
        `select policyname, cmd, roles, permissive, qual from pg_policies where schemaname='public' and tablename='${t.replace(
          /'/g,
          "''"
        )}'`
      );
      console.log("Policies:", policies);
    } catch (e) {
      console.log("Policies: error", e.message);
    }
    try {
      const grants = await q(
        `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='${t.replace(
          /'/g,
          "''"
        )}'`
      );
      console.log("Grants:", grants);
    } catch (e) {
      console.log("Grants: error", e.message);
    }
  }
}

main().catch((e) => {
  console.error("check-rls failed:", e.message);
  process.exit(1);
});
