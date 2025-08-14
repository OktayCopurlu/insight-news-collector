#!/usr/bin/env node
/**
 * Quick helper to set allowed_use for sources.
 * Usage: node scripts/source-policy-set.js <source_id_or_domain> <allow|deny>
 * allow => sets allowed_use to 'mirror_thumb'
 * deny  => sets allowed_use to 'link+snippet'
 */
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

const [target, action] = process.argv.slice(2);
if (!target || !action || !/^allow|deny$/.test(action)) {
  console.log(
    "Usage: node scripts/source-policy-set.js <source_id_or_domain> <allow|deny>"
  );
  process.exit(1);
}

const value = action === "allow" ? "mirror_thumb" : "link+snippet";

async function run() {
  // Try by id first
  let { data: src, error } = await supabase
    .from("sources")
    .select("id,domain,allowed_use")
    .eq("id", target)
    .maybeSingle();
  if (error) {
    console.error("Lookup error:", error.message);
    process.exit(1);
  }
  if (!src) {
    // Try by domain
    const { data: byDomain, error: e2 } = await supabase
      .from("sources")
      .select("id,domain,allowed_use")
      .eq("domain", target)
      .maybeSingle();
    if (e2) {
      console.error("Lookup error:", e2.message);
      process.exit(1);
    }
    src = byDomain;
  }
  if (!src) {
    console.error("Source not found by id or domain:", target);
    process.exit(1);
  }
  const { error: upErr } = await supabase
    .from("sources")
    .update({ allowed_use: value })
    .eq("id", src.id);
  if (upErr) {
    console.error("Update failed:", upErr.message);
    process.exit(1);
  }
  console.log(
    `Updated source ${src.id} (${src.domain}) allowed_use => '${value}'.`
  );
}

run();
