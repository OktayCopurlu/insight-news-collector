#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import { createContextLogger } from "../src/config/logger.js";
import { testConnection } from "../src/config/database.js";
import { startCronJobs } from "../src/scheduler/cronJobs.js";

const logger = createContextLogger("Worker");

(async () => {
  logger.info("Starting worker (cron scheduler)");
  const ok = await testConnection();
  if (!ok) {
    logger.error("Database connection failed; exiting");
    process.exit(1);
  }
  startCronJobs();

  // keep process alive
  process.stdin.resume();

  const onShutdown = (sig) => {
    logger.info("Received shutdown signal", { sig });
    // No open server to close; exit directly
    process.exit(0);
  };
  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);
})();
