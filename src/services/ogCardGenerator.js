import { createContextLogger } from "../config/logger.js";
import { supabase } from "../config/database.js";

const logger = createContextLogger("OgCard");

function sanitize(str, max = 140) {
  if (!str) return "";
  // Strip ASCII control characters from text embedded in SVG; intentional and safe
  const cleaned = String(str)
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return cleaned.slice(0, max);
}

function svgEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSvg({
  title,
  source,
  width = 1200,
  height = 630,
  bg = "#0F172A",
  fg = "#FFFFFF",
  accent = "#38BDF8",
}) {
  const safeTitle = svgEscape(sanitize(title, 160));
  const safeSource = svgEscape(sanitize(source, 60));
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}"/>
        <stop offset="100%" stop-color="${accent}" stop-opacity="0.25"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${
      width - 140
    }" cy="140" r="100" fill="${accent}" fill-opacity="0.15"/>
    <g fill="${fg}">
      <text x="64" y="140" font-family="-apple-system,Segoe UI,Inter,Arial,sans-serif" font-size="28" font-weight="600" opacity="0.85">${safeSource}</text>
      <rect x="64" y="160" width="72" height="6" rx="3" fill="${accent}"/>
      <foreignObject x="64" y="200" width="${width - 128}" height="${
    height - 240
  }">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: -apple-system,Segoe UI,Inter,Arial,sans-serif; color: ${fg}; font-size: 54px; line-height: 1.15; font-weight: 800;">
          ${safeTitle}
        </div>
      </foreignObject>
    </g>
  </svg>`;
}

export async function generateOgCardForArticle(article, _options = {}) {
  const bucket = process.env.MEDIA_STORAGE_BUCKET || "news-media";
  const width = parseInt(process.env.OGCARD_WIDTH || "1200", 10);
  const height = parseInt(process.env.OGCARD_HEIGHT || "630", 10);
  const bg = process.env.OGCARD_BG || "#0F172A";
  const fg = process.env.OGCARD_FG || "#FFFFFF";
  const accent = process.env.OGCARD_ACCENT || "#38BDF8";

  const title = article.title || article.snippet || "News";
  const source = article.source_name || "Insight";

  const svg = buildSvg({ title, source, width, height, bg, fg, accent });
  const bytes = Buffer.from(svg, "utf8");

  const y = new Date().getUTCFullYear();
  const m = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  const id = `${article.id}-ogcard.svg`;
  const storagePath = `${y}/${m}/${id}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType: "image/svg+xml",
      upsert: true,
    });
  if (error) throw error;

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  logger.info("OG card generated", {
    articleId: article.id,
    path: storagePath,
    publicUrl: pub?.publicUrl,
  });
  return {
    storagePath,
    publicUrl: pub?.publicUrl || null,
    contentType: "image/svg+xml",
    bytes: bytes.length,
  };
}
