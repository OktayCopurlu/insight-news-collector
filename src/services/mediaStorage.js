import axios from "axios";
import crypto from "node:crypto";
import path from "node:path";
import { createContextLogger } from "../config/logger.js";
import { supabase } from "../config/database.js";

const logger = createContextLogger("MediaStorage");

const MAX_BYTES = parseInt(
  process.env.MEDIA_MAX_DOWNLOAD_BYTES || "3000000",
  10
); // 3MB default
const BUCKET = process.env.MEDIA_STORAGE_BUCKET || "news-media";
const VARIANTS_ENABLED =
  (process.env.MEDIA_VARIANTS_ENABLED || "false").toLowerCase() === "true";
const VARIANT_WIDTHS = (process.env.MEDIA_VARIANT_WIDTHS || "400,800,1200")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);

const CONTENT_TYPE_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function guessExt(url, contentType) {
  if (contentType && CONTENT_TYPE_EXT[contentType])
    return CONTENT_TYPE_EXT[contentType];
  const u = new URL(url);
  const base = u.pathname.toLowerCase();
  if (base.endsWith(".jpg") || base.endsWith(".jpeg")) return "jpg";
  if (base.endsWith(".png")) return "png";
  if (base.endsWith(".webp")) return "webp";
  if (base.endsWith(".gif")) return "gif";
  return "jpg";
}

export async function mirrorImageToStorage(url) {
  // HEAD to check size if available
  try {
    const head = await axios.head(url, {
      timeout: Math.min(
        parseInt(process.env.FETCH_TIMEOUT_MS || "15000", 10),
        8000
      ),
      headers: {
        "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const len = parseInt(head.headers["content-length"] || "0", 10);
    if (len && MAX_BYTES && len > MAX_BYTES) {
      throw new Error(`content too large: ${len} > ${MAX_BYTES}`);
    }
  } catch (_) {
    // Some CDNs block HEAD; continue to GET
  }

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: Math.min(
      parseInt(process.env.FETCH_TIMEOUT_MS || "15000", 10),
      15000
    ),
    headers: {
      "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
    },
    maxRedirects: 3,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const contentType = res.headers["content-type"] || null;
  const hash = crypto.createHash("sha256");
  const chunks = [];
  let total = 0;

  await new Promise((resolve, reject) => {
    res.data.on("data", (chunk) => {
      total += chunk.length;
      if (MAX_BYTES && total > MAX_BYTES) {
        res.data.destroy();
        reject(new Error(`download exceeded limit ${MAX_BYTES}`));
        return;
      }
      chunks.push(chunk);
      hash.update(chunk);
    });
    res.data.on("end", resolve);
    res.data.on("error", reject);
  });

  const buffer = Buffer.concat(chunks);
  const digest = hash.digest("hex");
  let metaWidth = null;
  let metaHeight = null;
  let variants = [];

  // Optionally generate responsive variants via sharp
  if (VARIANTS_ENABLED) {
    const baseExt = guessExt(url, contentType);
    // Skip GIF/unknown for variants
    if (baseExt !== "gif") {
      try {
        const sharp = (await import("sharp")).default;
        const img = sharp(buffer, { sequentialRead: true });
        const md = await img.metadata();
        metaWidth = md.width || null;
        metaHeight = md.height || null;
        const targetWidths = (
          metaWidth
            ? VARIANT_WIDTHS.filter((w) => w <= metaWidth)
            : VARIANT_WIDTHS
        ).filter((w, i, arr) => arr.indexOf(w) === i);
        for (const w of targetWidths) {
          try {
            const resized = await sharp(buffer)
              .resize({ width: w, withoutEnlargement: true })
              .toFormat(
                baseExt === "png" ? "png" : baseExt === "webp" ? "webp" : "jpeg"
              )
              .toBuffer();
            const extOut =
              baseExt === "png" ? "png" : baseExt === "webp" ? "webp" : "jpg";
            const now = new Date();
            const yyyy = String(now.getUTCFullYear());
            const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
            const vPath = path.posix.join(
              yyyy,
              mm,
              `${digest}_w${w}.${extOut}`
            );
            const { error: vErr } = await supabase.storage
              .from(BUCKET)
              .upload(vPath, resized, {
                contentType:
                  extOut === "png"
                    ? "image/png"
                    : extOut === "webp"
                    ? "image/webp"
                    : "image/jpeg",
                upsert: true,
              });
            if (vErr) throw vErr;
            const { data: vPub } = supabase.storage
              .from(BUCKET)
              .getPublicUrl(vPath);
            variants.push({
              width: w,
              storagePath: vPath,
              publicUrl: vPub?.publicUrl || null,
              bytes: resized.length,
            });
          } catch (ve) {
            logger.warn("Variant generation failed", {
              width: w,
              error: ve.message,
            });
          }
        }
      } catch (se) {
        logger.warn("Sharp not available or failed; skipping variants", {
          error: se.message,
        });
      }
    }
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = guessExt(url, contentType);
  const storagePath = path.posix.join(yyyy, mm, `${digest}.${ext}`);

  // Upload (idempotent by digest-based path)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: contentType || "application/octet-stream",
      upsert: false,
    });
  if (
    error &&
    !String(error.message || "").includes("The resource already exists")
  ) {
    throw error;
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  logger.info("Mirrored image", {
    path: storagePath,
    bytes: buffer.length,
    contentType,
    publicUrl: pub?.publicUrl,
  });

  return {
    hash: digest,
    storagePath,
    contentType: contentType || null,
    publicUrl: pub?.publicUrl || null,
    bytes: buffer.length,
    width: metaWidth,
    height: metaHeight,
    variants,
  };
}
