import { createContextLogger } from "../config/logger.js";
import { supabase } from "../config/database.js";

const logger = createContextLogger("AIIllustrator");

function hashToHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function buildAbstractSvg({ title, width = 1200, height = 630, hue = 200 }) {
  const bg = `hsl(${hue}, 55%, 14%)`;
  const fg = `hsl(${(hue + 180) % 360}, 90%, 92%)`;
  const acc = `hsl(${(hue + 20) % 360}, 85%, 55%)`;
  const stripControlChars = (s) =>
    String(s || "")
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 32 && code !== 127; // keep printable ASCII; drop C0 and DEL
      })
      .join("");
  const safeTitle = stripControlChars(title || "Illustration").slice(0, 90);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${acc}" stop-opacity="0.25"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g1)"/>
  <g opacity="0.25" fill="none" stroke="${fg}">
    <circle cx="${width * 0.75}" cy="${height * 0.25}" r="160" />
    <circle cx="${width * 0.2}" cy="${height * 0.7}" r="100" />
    <path d="M 0 ${height * 0.85} C ${width * 0.25} ${height * 0.7}, ${
    width * 0.5
  } ${height * 0.95}, ${width} ${height * 0.8}" stroke-width="6"/>
  </g>
  <g fill="${fg}">
    <rect x="56" y="64" width="128" height="36" rx="8" fill="${acc}"/>
    <text x="72" y="88" font-family="-apple-system,Segoe UI,Inter,Arial,sans-serif" font-size="18" font-weight="700">Illustration</text>
    <foreignObject x="56" y="120" width="${width - 112}" height="${
    height - 180
  }">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: -apple-system,Segoe UI,Inter,Arial,sans-serif; color: ${fg}; font-size: 48px; line-height: 1.15; font-weight: 800;">
        ${safeTitle}
      </div>
    </foreignObject>
  </g>
</svg>`;
}

export async function generateIllustrationForArticle(article, _options = {}) {
  const provider = (process.env.AI_IMAGE_PROVIDER || "svg").toLowerCase();
  const bucket = process.env.MEDIA_STORAGE_BUCKET || "news-media";
  const width = parseInt(
    process.env.AI_IMAGE_WIDTH || process.env.OGCARD_WIDTH || "1200",
    10
  );
  const height = parseInt(
    process.env.AI_IMAGE_HEIGHT || process.env.OGCARD_HEIGHT || "630",
    10
  );

  if (provider !== "svg") {
    // Placeholder for future providers (e.g., replicate). Currently unsupported.
    const allowed = ["svg"]; // extend later
    logger.info("AI image provider not configured; falling back to SVG", {
      provider,
      allowed,
    });
  }

  const hue = hashToHue(article.id || article.title || "seed");
  const svg = buildAbstractSvg({
    title: article.title || "News",
    width,
    height,
    hue,
  });
  const bytes = Buffer.from(svg, "utf8");

  const y = new Date().getUTCFullYear();
  const m = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  const file = `${article.id}-ai-illustration.svg`;
  const storagePath = `${y}/${m}/${file}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, { contentType: "image/svg+xml", upsert: true });
  if (error) throw error;

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  logger.info("AI illustration generated", {
    articleId: article.id,
    path: storagePath,
    publicUrl: pub?.publicUrl,
  });
  return {
    storagePath,
    publicUrl: pub?.publicUrl || null,
    contentType: "image/svg+xml",
    width,
    height,
    caption: "Illustration",
  };
}
