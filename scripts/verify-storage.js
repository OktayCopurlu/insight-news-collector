#!/usr/bin/env node
/**
 * Verifies Supabase Storage bucket for media and basic public access.
 * - Ensures bucket exists (creates if missing)
 * - Uploads a tiny probe file and fetches its public URL
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const BUCKET = process.env.MEDIA_STORAGE_BUCKET || "news-media";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function ensureBucket() {
  try {
    const { data: list, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) throw listErr;
    const exists = (list || []).some((b) => b.name === BUCKET);
    if (exists) return false;
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
    });
    if (createErr) throw createErr;
    return true;
  } catch (e) {
    console.error("Bucket check/create failed:", e.message);
    process.exit(1);
  }
}

async function probeUpload() {
  const ts = Date.now();
  const path = `probes/${ts}.txt`;
  const content = new TextEncoder().encode("ok");
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, content, {
      contentType: "text/plain",
      upsert: true,
    });
  if (upErr) {
    console.error("Upload failed:", upErr.message);
    process.exit(1);
  }
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log("Probe public URL:", pub?.publicUrl || "(none)");
}

async function main() {
  const created = await ensureBucket();
  console.log(
    created
      ? `Bucket '${BUCKET}' created (public:true).`
      : `Bucket '${BUCKET}' exists.`
  );
  await probeUpload();
  console.log(
    "If the URL above returns 200 in a browser, public access policy is OK."
  );
}

main();
