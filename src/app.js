import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

import { createContextLogger } from "./config/logger.js";
import { testConnection } from "./config/database.js";
import { generalRateLimit } from "./middleware/rateLimiter.js";
import { optionalAuth } from "./middleware/auth.js";

// Import routes
import feedsRouter from "./routes/feeds.js";
import sourcesRouter from "./routes/sources.js";
import clustersRouter from "./routes/clusters.js";
import contentRouter from "./routes/content.js";
import { translationMetrics } from "./services/translationHelper.js";
import { pretranslateMetrics } from "./services/pretranslator.js";

dotenv.config();

const app = express();
const logger = createContextLogger("App");

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

// CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting
app.use(generalRateLimit);

// Optional authentication for all routes
app.use(optionalAuth);

// Health check endpoint (lightweight, non-blocking DB status)
let lastDbHealth = { status: "unknown", checkedAt: null };
const DB_HEALTH_TTL_MS = 30000; // refresh every 30s in background

app.get("/health", async (req, res) => {
  const now = Date.now();
  const stale =
    !lastDbHealth.checkedAt || now - lastDbHealth.checkedAt > DB_HEALTH_TTL_MS;
  if (stale) {
    // Fire and forget DB health refresh
    testConnection()
      .then((ok) => {
        lastDbHealth = {
          status: ok ? "connected" : "disconnected",
          checkedAt: Date.now(),
        };
      })
      .catch(() => {
        lastDbHealth = { status: "disconnected", checkedAt: Date.now() };
      });
  }
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    database: lastDbHealth,
  });
});

// Lightweight metrics endpoint (JSON)
app.get("/metrics", (req, res) => {
  res.json({
    service: "insight-feeder",
    version: process.env.npm_package_version || "1.0.0",
    ts: new Date().toISOString(),
    translation: translationMetrics,
    pretranslation: pretranslateMetrics,
  });
});

// Explicit DB health endpoint (synchronous check)
app.get("/health/db", async (req, res) => {
  const started = Date.now();
  try {
    const ok = await testConnection();
    lastDbHealth = {
      status: ok ? "connected" : "disconnected",
      checkedAt: Date.now(),
    };
    res.status(ok ? 200 : 503).json({
      success: ok,
      database: lastDbHealth.status,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    lastDbHealth = { status: "disconnected", checkedAt: Date.now() };
    res.status(503).json({
      success: false,
      database: "disconnected",
      error: error.message,
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  }
});

// API routes
app.use("/api/feeds", feedsRouter);
app.use("/api/sources", sourcesRouter);
app.use("/api/clusters", clustersRouter);
app.use("/api/content", contentRouter);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Insight Feeder API",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      feeds: "/api/feeds",
      sources: "/api/sources",
      clusters: "/api/clusters",
      content: "/api/content",
    },
    documentation: "https://github.com/your-repo/insight-feeder",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.originalUrl,
    method: req.method,
  });
});

// Global error handler
app.use((error, req, res, _next) => {
  logger.error("Unhandled error", {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: "Internal server error",
    ...(process.env.NODE_ENV === "development" && {
      details: error.message,
      stack: error.stack,
    }),
  });
});

export default app;
