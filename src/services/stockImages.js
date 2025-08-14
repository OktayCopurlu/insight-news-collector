import fs from "node:fs";
import path from "node:path";
import { createContextLogger } from "../config/logger.js";
import { isValidUrl } from "../utils/helpers.js";

const logger = createContextLogger("StockImages");
let cachedConfig = null;
let cachedPath = null;

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function loadStockConfig() {
  const cfgPath =
    process.env.STOCK_CONFIG_PATH ||
    path.resolve(process.cwd(), "stock-config.json");
  if (cachedConfig && cachedPath === cfgPath) return cachedConfig;
  const exists = fs.existsSync(cfgPath);
  if (!exists) {
    logger.debug(
      "Stock config not found; stock fallback disabled unless provided",
      { cfgPath }
    );
    cachedConfig = { matchers: [], default: [] };
    cachedPath = cfgPath;
    return cachedConfig;
  }
  const json = readJsonSafe(cfgPath) || { matchers: [], default: [] };
  // normalize
  json.matchers = Array.isArray(json.matchers) ? json.matchers : [];
  json.default = Array.isArray(json.default) ? json.default : [];
  cachedConfig = json;
  cachedPath = cfgPath;
  logger.info("Loaded stock config", {
    cfgPath,
    matchers: json.matchers.length,
    defaultCount: json.default.length,
  });
  return cachedConfig;
}

export function selectStockImage(article) {
  const enabled =
    (process.env.MEDIA_STOCK_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) return null;
  const cfg = loadStockConfig();
  const text = `${article.title || ""} ${article.snippet || ""}`;
  const hits = [];
  for (const m of cfg.matchers) {
    if (!m?.pattern || !Array.isArray(m?.urls)) continue;
    try {
      const re = new RegExp(m.pattern, "i");
      if (re.test(text)) {
        for (const u of m.urls) if (isValidUrl(u)) hits.push(u);
      }
    } catch (_) {}
  }
  const pool = hits.length ? hits : cfg.default.filter(isValidUrl);
  if (!pool.length) return null;
  // simple deterministic pick using article id hash
  const idx =
    Math.abs(
      (article.id || "")
        .split("-")
        .join("")
        .split("")
        .reduce((a, c) => a + c.charCodeAt(0), 0)
    ) % pool.length;
  return pool[idx];
}
