import dotenv from "dotenv";
dotenv.config();

import { crawlAllFeeds } from "../src/services/feedCrawler.js";
import { crawlNewsdataOnly } from "../src/services/newsdataCrawler.js";
import { createContextLogger } from "../src/config/logger.js";
import { testConnection } from "../src/config/database.js";

const logger = createContextLogger("RunCrawl");

const run = async () => {
  logger.info("Starting one-off feed crawl");
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn("Database connection failed; aborting crawl");
    process.exit(1);
  }
  try {
    const mode = (process.env.SOURCE_MODE || "rss").toLowerCase();
    const results =
      mode === "newsdata" ? await crawlNewsdataOnly() : await crawlAllFeeds();
    logger.info("Crawl finished", results);
    console.log(JSON.stringify({ success: true, ...results }, null, 2));
    process.exit(0);
  } catch (e) {
    logger.error("Crawl failed", { error: e.message });
    console.error(JSON.stringify({ success: false, error: e.message }));
    process.exit(1);
  }
};

run();
