import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  try {
    const { data: counts, error: e1 } = await supabase
      .from("cluster_ai")
      .select("lang, is_current")
      .eq("is_current", true);
    if (e1) throw e1;
    const tally = new Map();
    for (const r of counts || []) {
      const k = (r.lang || "").toLowerCase();
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    const tallyObj = Object.fromEntries(
      [...tally.entries()].sort((a, b) => b[1] - a[1])
    );
    console.log("Current cluster_ai rows by lang:");
    for (const [lang, n] of Object.entries(tallyObj)) {
      console.log(`${lang}: ${n}`);
    }

    const { data: sample, error: e2 } = await supabase
      .from("cluster_ai")
      .select("cluster_id, lang, ai_title, pivot_hash, model")
      .eq("is_current", true)
      .not("lang", "eq", "en")
      .limit(10);
    if (e2) throw e2;
    const result = {
      tally: tallyObj,
      samples: [],
      generatedAt: new Date().toISOString(),
    };
    if (!sample || !sample.length) {
      console.log(
        "No non-pivot translations yet (try running cluster:enrich then pretranslate)"
      );
    } else {
      console.log("\nSample translated rows (non-en):");
      for (const r of sample) {
        const item = {
          cluster_id: r.cluster_id,
          lang: r.lang,
          ai_title: (r.ai_title || "").slice(0, 160),
          pivot_hash: r.pivot_hash || "",
          model: r.model || "",
        };
        result.samples.push(item);
        console.log(
          `cluster=${item.cluster_id} lang=${item.lang} title=${item.ai_title} ph=${item.pivot_hash}`
        );
      }
    }

    const outDir = path.join(process.cwd(), "scripts", "out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "verify-translations.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );
    process.exit(0);
  } catch (e) {
    console.error("Verification failed:", e.message);
    process.exit(2);
  }
}

main();
