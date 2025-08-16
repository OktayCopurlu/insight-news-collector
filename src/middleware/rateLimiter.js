import { createRateLimiter } from "../utils/helpers.js";
import { createContextLogger } from "../config/logger.js";

const logger = createContextLogger("RateLimiter");

// Create different rate limiters for different endpoints
const rateLimiters = {
  general: createRateLimiter(100, 60 * 1000), // 100 requests per minute
  crawl: createRateLimiter(10, 60 * 1000), // 10 crawl requests per minute
  ai: createRateLimiter(20, 60 * 1000), // 20 AI requests per minute
  search: createRateLimiter(30, 60 * 1000), // 30 search requests per minute
};

const createRateLimit = (type = "general") => {
  const limiter = rateLimiters[type] || rateLimiters.general;

  return (req, res, next) => {
    const clientId = req.ip || req.connection.remoteAddress || "unknown";
    const key = `${type}:${clientId}`;

    if (!limiter(key)) {
      logger.warn("Rate limit exceeded", {
        type,
        clientId: clientId.substring(0, 10) + "...",
        path: req.path,
      });

      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded. Please try again later.",
        retryAfter: 60,
      });
    }

    next();
  };
};

export const generalRateLimit = createRateLimit("general");
