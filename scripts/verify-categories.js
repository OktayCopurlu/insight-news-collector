import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load env vars from .env if present
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  try {
    const { count: artCount, error: artErr } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true });
    if (artErr) throw artErr;
    const { count: acCount, error: acErr } = await supabase
      .from("article_categories")
      .select("article_id", { count: "exact", head: true });
    if (acErr) throw acErr;

    const result = {
      articles: artCount || 0,
      articleCategoryLinks: acCount || 0,
      samples: [],
      generatedAt: new Date().toISOString(),
    };
    console.log("Articles:", result.articles);
    console.log("Article->Category links:", result.articleCategoryLinks);

    // Manual join to categories via two-step fetch for simplicity
    const { data: sampleAC } = await supabase
      .from("article_categories")
      .select("article_id, category_id, confidence")
      .limit(10);

    if (!sampleAC || !sampleAC.length) {
      console.log("No article_categories rows yet.");
      // write file anyway
      const outDir = path.join(process.cwd(), "scripts", "out");
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "verify-categories.json"),
        JSON.stringify(result, null, 2),
        "utf8"
      );
      return process.exit(0);
    }
    const catIds = Array.from(new Set(sampleAC.map((r) => r.category_id)));
    const { data: cats } = await supabase
      .from("categories")
      .select("id, path")
      .in("id", catIds);
    const pathById = new Map((cats || []).map((c) => [c.id, c.path]));

    console.log("\nSample article_categories (up to 10):");
    sampleAC.forEach((r) => {
      const pathStr = pathById.get(r.category_id);
      result.samples.push({
        article_id: r.article_id,
        path: pathStr,
        confidence: r.confidence,
      });
      console.log(
        `article_id=${r.article_id} path=${pathStr} conf=${r.confidence}`
      );
    });

    // Write structured output
    const outDir = path.join(process.cwd(), "scripts", "out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "verify-categories.json"),
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
