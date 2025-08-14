#!/usr/bin/env node
/**
 * Simple migration runner for the local migrations folder.
 * Applies any *.sql or *.txt files (in lexical order) whose filename has not
 * yet been recorded in schema_migrations.
 * Requires SUPABASE_SERVICE_ROLE_KEY and exec_sql RPC.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

async function ensureMetaTable() {
  const { error } = await supabase.rpc("exec_sql", {
    sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text primary key,
      executed_at timestamptz default now()
    );
  `,
  });
  if (error) throw error;
}

async function listApplied(retries = 5) {
  for (let i = 0; i < retries; i++) {
    const { data, error } = await supabase
      .from("schema_migrations")
      .select("filename");
    if (!error) return new Set((data || []).map((r) => r.filename));
    const msg = (error.message || "").toLowerCase();
    if (
      msg.includes("schema_migrations") ||
      msg.includes("schema cache") ||
      msg.includes("relation")
    ) {
      // Table might be freshly created; wait and retry
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      continue;
    }
    throw error;
  }
  // Last attempt after retries
  const { data, error } = await supabase
    .from("schema_migrations")
    .select("filename");
  if (error) throw error;
  return new Set((data || []).map((r) => r.filename));
}

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /\.(sql|txt)$/i.test(f))
    .sort();
}

async function applyMigration(file) {
  const fullPath = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(fullPath, "utf8");
  console.log(`Applying migration: ${file}`);
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error(`Migration failed (${file}):`, error.message);
    process.exit(1);
  }
  // Record applied using SQL to avoid schema cache timing issues
  const { error: insErr } = await supabase.rpc("exec_sql", {
    sql: `insert into schema_migrations(filename) values ('${file.replace(
      /'/g,
      "''"
    )}') on conflict (filename) do nothing;`,
  });
  if (insErr) {
    console.error("Failed to record migration:", insErr.message);
    process.exit(1);
  }
  console.log(`✔ Applied ${file}`);
}

async function main() {
  console.log("Running migrations...");
  await ensureMetaTable();
  const applied = await listApplied();
  const files = readMigrations();
  const pending = files.filter((f) => !applied.has(f));
  if (!pending.length) {
    console.log("No pending migrations.");
    return;
  }
  for (const f of pending) {
    await applyMigration(f);
  }
  console.log("Migrations complete.");
}

main().catch((e) => {
  console.error("Migration runner failed:", e.message);
  process.exit(1);
});
