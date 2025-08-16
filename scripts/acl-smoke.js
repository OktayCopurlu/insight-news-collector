#!/usr/bin/env node
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.error("Missing SUPABASE_URL and/or SUPABASE_ANON_KEY");
  process.exit(1);
}

const anonClient = createClient(url, anon);

async function trySelect(name, _type = "table") {
  try {
    const { data, error } = await anonClient.from(name).select("*").limit(1);
    if (error) {
      console.log(`${name}: DENIED (${error.message})`);
    } else {
      console.log(`${name}: ALLOWED (unexpected) ->`, data);
    }
  } catch (e) {
    console.log(`${name}: ERROR (${e.message})`);
  }
}

(async () => {
  const objects = [
    "clusters",
    "cluster_ai",
    "cluster_updates",
    "v_articles_public",
    "v_cluster_reps",
    "v_clusters_needing_ai",
  ];
  for (const o of objects) {
    await trySelect(o);
  }
})();
