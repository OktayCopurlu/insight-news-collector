import dotenv from "dotenv";
import { createContextLogger } from "../src/config/logger.js";
import { selectRecords } from "../src/config/database.js";

dotenv.config();
const logger = createContextLogger("AuditMedia");

async function main() {
  const hours = parseInt(process.argv[2] || "48", 10);
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  logger.info("Auditing articles missing images", { hours, sinceIso });

  // Fetch recent articles
  const articles = await selectRecords(
    "articles",
    {},
    { orderBy: { column: "published_at", ascending: false }, limit: 1000 }
  );
  let missing = 0;
  let total = 0;
  for (const a of articles) {
    if (a.published_at && a.published_at < sinceIso) continue;
    total++;
    // check link in article_media
    // Since selectRecords is simple eq, fetch join via two calls
    const am = await fetchArticleMedia(a.id);
    if (!am || am.length === 0) {
      missing++;
      logger.info("No media linked", {
        id: a.id,
        title: a.title?.slice(0, 100),
        url: a.canonical_url || a.url,
      });
    }
  }
  logger.info("Audit complete", {
    total,
    missing,
    coverage: `${total - missing}/${total}`,
  });
}

async function fetchArticleMedia(articleId) {
  // Simple select; in absence of RPC, filter client-side
  const all = await selectRecords("article_media", {});
  return all.filter((x) => x.article_id === articleId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
