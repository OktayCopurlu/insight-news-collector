#!/usr/bin/env node
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or key envs");
  process.exit(1);
}
const supabase = createClient(url, key);

async function count(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

(async () => {
  const tables = [
    'articles',
    'clusters',
    'cluster_ai',
    'cluster_updates',
    'crawl_log',
    'sources',
    'feeds',
    'app_markets'
  ];
  const result = {};
  for (const t of tables) {
    try { result[t] = await count(t); } catch (e) { result[t] = `ERR: ${e.message}`; }
  }
  console.log(JSON.stringify(result, null, 2));
})();
