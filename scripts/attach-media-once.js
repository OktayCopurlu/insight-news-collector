#!/usr/bin/env node
import { createContextLogger } from "../src/config/logger.js";
import { selectRecords } from "../src/config/database.js";
import { selectAttachBestImage } from "../src/services/mediaSelector.js";

const logger = createContextLogger("AttachMediaOnce");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: node scripts/attach-media-once.js <article_id>");
    process.exit(2);
  }
  const [article] = await selectRecords("articles", { id });
  if (!article) {
    console.error("Article not found:", id);
    process.exit(3);
  }
  logger.info("Attaching media for article", {
    id: article.id,
    title: article.title,
  });
  const res = await selectAttachBestImage(article);
  if (res) {
    logger.info("Attached", {
      url: res.url,
      width: res.width,
      height: res.height,
    });
  } else {
    logger.warn("No media attached (candidates empty and fallbacks disabled?)");
    process.exit(4);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
