import axios from "axios";
import { JSDOM } from "jsdom";
import probe from "probe-image-size";
import { createContextLogger } from "../config/logger.js";
import {
  supabase,
  selectRecords,
  insertRecord,
  updateRecord,
} from "../config/database.js";
import { mirrorImageToStorage } from "./mediaStorage.js";
import { generateOgCardForArticle } from "./ogCardGenerator.js";
import { selectStockImage } from "./stockImages.js";
import { generateContentHash, isValidUrl } from "../utils/helpers.js";
import { canMirrorMediaForArticle } from "./policy.js";
import { generateIllustrationForArticle } from "./aiIllustrator.js";

const logger = createContextLogger("MediaSelector");

const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "15000");
const MIN_WIDTH = parseInt(process.env.MEDIA_MIN_WIDTH || "0");
const ACCEPTED_ASPECTS = (process.env.MEDIA_ACCEPTED_ASPECTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const VERIFY_HEAD =
  (process.env.MEDIA_VERIFY_HEAD || "false").toLowerCase() === "true";

function toAbsolute(url, base) {
  try {
    if (!url) return null;
    const u = new URL(url, base);
    return u.toString();
  } catch (_) {
    return null;
  }
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function isAcceptableImageUrl(u) {
  if (!u || typeof u !== "string") return false;
  if (/^data:/i.test(u)) return false;
  if (/\.svg(\?|#|$)/i.test(u)) return false;
  if (/\.gif(\?|#|$)/i.test(u)) return false;
  return isValidUrl(u);
}

function hostnameOf(u) {
  try {
    return new URL(u).hostname;
  } catch (_) {
    return null;
  }
}

function sameDomainBoost(articleUrl, imgUrl) {
  const a = hostnameOf(articleUrl);
  const b = hostnameOf(imgUrl);
  if (!a || !b) return 0;
  return a === b ? 2 : 0;
}

function parseAspect(str) {
  const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(str || "");
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return null;
  return w / h;
}

function withinAcceptedAspect(
  width,
  height,
  accepted = ACCEPTED_ASPECTS,
  tolerance = 0.12
) {
  if (!width || !height) return true; // if unknown, don't block
  if (!accepted || accepted.length === 0) return true;
  const ratio = width / height;
  for (const s of accepted) {
    const ar = parseAspect(s);
    if (!ar) continue;
    const diff = Math.abs(ratio - ar) / ar;
    if (diff <= tolerance) return true;
  }
  return false;
}

export function extractMetaImagesFromHtml(html, baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;
  const candidates = [];

  const pick = (sel, attr = "content") =>
    doc
      .querySelectorAll(sel)
      .forEach((el) => candidates.push(el.getAttribute(attr)));

  // OpenGraph and Twitter
  pick('meta[property="og:image:secure_url"]');
  pick('meta[property="og:image"]');
  pick('meta[name="twitter:image:src"]');
  pick('meta[name="twitter:image"]');

  // Link rel image_src
  pick('link[rel="image_src"]', "href");

  // JSON-LD images
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const json = JSON.parse(s.textContent || "{}");
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item && typeof item === "object") {
          const add = (val) => {
            if (!val) return;
            if (typeof val === "string") candidates.push(val);
            else if (Array.isArray(val)) val.forEach(add);
            else if (typeof val === "object" && val.url)
              candidates.push(val.url);
          };
          add(item.image);
          if (item.thumbnailUrl) add(item.thumbnailUrl);
          if (item.logo) add(item.logo);
        }
      }
    } catch (_) {}
  });

  // Filter and absolutize
  const abs = unique(
    candidates
      .map((u) => toAbsolute(u, baseUrl))
      .filter((u) => isAcceptableImageUrl(u))
  );

  // Lightweight preference: prefer jpg/png, de-prioritize webp; avoid logos/sprites
  const baseScore = (u) => {
    let s = 0;
    if (/\.jpe?g(\?|#|$)/i.test(u)) s += 3;
    if (/\.png(\?|#|$)/i.test(u)) s += 2;
    if (/\/large|\/big|\b1200x|\b1080x|\b800x/i.test(u)) s += 1;
    if (/\.webp(\?|#|$)/i.test(u)) s -= 1;
    if (/logo|sprite|icon/i.test(u)) s -= 2;
    return s;
  };

  return abs.sort((a, b) => baseScore(b) - baseScore(a));
}

async function fetchPageMetaImages(url) {
  try {
    const resp = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: "text",
      headers: {
        "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    const html = resp.data || "";
    return extractMetaImagesFromHtml(html, url);
  } catch (e) {
    logger.warn("Failed to fetch page for meta images", {
      url,
      error: e.message,
    });
    return [];
  }
}

async function upsertMediaAsset(origin, url) {
  const id = generateContentHash(origin, url);
  // Use direct upsert to avoid noisy duplicate key error logs
  const { data, error } = await supabase
    .from("media_assets")
    .upsert({ id, origin, url }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function selectAttachBestImage(article, _opts = {}) {
  // Default ON so freshly ingested articles attach images without separate backfills
  const enabled =
    (process.env.MEDIA_ENABLED || "true").toLowerCase() === "true";
  if (!enabled) return null;

  const allowHtmlMeta =
    (process.env.MEDIA_FROM_HTML_META || "true").toLowerCase() === "true";
  const allowFromRss =
    (process.env.MEDIA_FROM_RSS || "true").toLowerCase() === "true";
  const storageEnabled =
    (process.env.MEDIA_STORAGE_ENABLED || "true").toLowerCase() === "true";
  const ogCardEnabled =
    (process.env.MEDIA_FALLBACK_OGCARD_ENABLED || "true").toLowerCase() ===
    "true";
  const aiEnabled =
    (process.env.MEDIA_AI_ENABLED || "false").toLowerCase() === "true";
  const aiAllowed = (process.env.MEDIA_AI_ALLOWED_CATEGORIES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const articleUrl = article.canonical_url || article.url;

  let candidates = [];
  // RSS-provided media candidates (if present on the article object)
  if (
    allowFromRss &&
    Array.isArray(article.media_candidates) &&
    article.media_candidates.length
  ) {
    candidates.push(...article.media_candidates);
  }
  if (allowHtmlMeta) {
    const metas = await fetchPageMetaImages(articleUrl);
    candidates.push(...metas);
  }

  candidates = unique(candidates);
  if (!candidates.length) {
    logger.debug("No media candidates found", { articleId: article.id });
    // Optional stock fallback
    const stockUrl = selectStockImage(article);
    if (stockUrl) {
      try {
        const media = await upsertMediaAsset("stock", stockUrl);
        if (storageEnabled) {
          try {
            const mirrored = await mirrorImageToStorage(stockUrl);
            if (mirrored?.hash) {
              const existing = await selectRecords("media_assets", {
                hash: mirrored.hash,
              });
              if (existing && existing[0]) {
                await insertRecord("article_media", {
                  article_id: article.id,
                  media_id: existing[0].id,
                  role: "thumbnail",
                  position: 0,
                });
                return { media: existing[0], url: existing[0].url || stockUrl };
              } else {
                await updateRecord("media_assets", media.id, {
                  storage_path: mirrored.storagePath,
                  hash: mirrored.hash,
                });
              }
            }
          } catch (e) {
            logger.warn("Stock mirroring failed", {
              url: stockUrl,
              error: e.message,
            });
          }
        }
        try {
          await insertRecord("article_media", {
            article_id: article.id,
            media_id: media.id,
            role: "thumbnail",
            position: 0,
          });
        } catch (e) {
          if (!/duplicate key value/.test(e.message || "")) throw e;
        }
        logger.info("Attached stock fallback", {
          articleId: article.id,
          url: stockUrl,
        });
        return { media, url: stockUrl };
      } catch (e) {
        logger.warn("Failed to attach stock image", {
          articleId: article.id,
          error: e.message,
        });
      }
    }
    // Optional AI illustration fallback (before OG-card)
    if (aiEnabled && storageEnabled) {
      // Only allow for generic categories if configured
      const cat = String(article.category || "").toLowerCase();
      const aiCategoryOk = aiAllowed.length === 0 || aiAllowed.includes(cat);
      if (!aiCategoryOk) {
        logger.debug("AI illustration disabled for category", {
          category: cat,
        });
      }
      if (!aiCategoryOk) {
        // skip AI fallback
      } else {
        try {
          const ill = await generateIllustrationForArticle(article);
          const id = generateContentHash(
            "ai_illustration",
            article.id,
            ill.storagePath
          );
          let media;
          try {
            media = await insertRecord("media_assets", {
              id,
              origin: "ai_generated",
              url: ill.publicUrl,
              storage_path: ill.storagePath,
              width: ill.width,
              height: ill.height,
              caption: ill.caption,
              license: "internal",
              hash: null,
            });
          } catch (e) {
            if (!/duplicate key value/.test(e.message || "")) throw e;
            const [existing] = await selectRecords("media_assets", { id });
            media = existing;
          }
          try {
            await insertRecord("article_media", {
              article_id: article.id,
              media_id: media.id,
              role: "thumbnail",
              position: 0,
            });
          } catch (e) {
            if (!/duplicate key value/.test(e.message || "")) throw e;
          }
          logger.info("Attached AI illustration fallback", {
            articleId: article.id,
            url: ill.publicUrl,
          });
          return {
            media,
            url: ill.publicUrl,
            width: ill.width,
            height: ill.height,
          };
        } catch (e) {
          logger.warn("AI illustration generation failed", {
            articleId: article.id,
            error: e.message,
          });
        }
      }
    }

    // Optional OG-card fallback
    if (ogCardEnabled && storageEnabled) {
      try {
        const card = await generateOgCardForArticle(article);
        const id = generateContentHash("og_card", article.id, card.storagePath);
        let media;
        try {
          media = await insertRecord("media_assets", {
            id,
            origin: "og_card",
            url: card.publicUrl,
            storage_path: card.storagePath,
            width: 1200,
            height: 630,
            caption: "OG card",
            license: "internal",
            hash: null,
          });
        } catch (e) {
          if (!/duplicate key value/.test(e.message || "")) throw e;
          const [existing] = await selectRecords("media_assets", { id });
          media = existing;
        }
        try {
          await insertRecord("article_media", {
            article_id: article.id,
            media_id: media.id,
            role: "thumbnail",
            position: 0,
          });
        } catch (e) {
          if (!/duplicate key value/.test(e.message || "")) throw e;
        }
        logger.info("Attached OG-card fallback", {
          articleId: article.id,
          url: card.publicUrl,
        });
        return { media, url: card.publicUrl, width: 1200, height: 630 };
      } catch (e) {
        logger.warn("OG-card generation failed", {
          articleId: article.id,
          error: e.message,
        });
      }
    }
    return null;
  }

  // Evaluate candidates: verify content-type (optional), probe dimensions (optional), score
  const evaluated = [];
  for (const u of candidates) {
    let ok = true;
    let reason = null;
    let width = null;
    let height = null;
    let contentType = null;
    // Optional HEAD to verify content-type is image/*
    if (ok && VERIFY_HEAD) {
      try {
        const head = await axios.head(u, {
          timeout: Math.min(FETCH_TIMEOUT_MS, 8000),
          headers: {
            "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
          },
          validateStatus: (s) => s >= 200 && s < 400,
        });
        contentType = head.headers["content-type"] || null;
        if (!contentType || !contentType.startsWith("image/")) {
          ok = false;
          reason = `non-image content-type: ${contentType || "unknown"}`;
        }
      } catch (e) {
        ok = false;
        reason = `HEAD failed: ${e.message}`;
      }
    }
    // Probe dimensions if min width or aspect filters are configured
    if (ok && (MIN_WIDTH > 0 || ACCEPTED_ASPECTS.length > 0)) {
      try {
        const res = await axios.get(u, {
          responseType: "stream",
          timeout: Math.min(FETCH_TIMEOUT_MS, 10000),
          headers: {
            "User-Agent": process.env.FEED_USER_AGENT || "InsightFeeder/1.0",
          },
          maxRedirects: 3,
          validateStatus: (s) => s >= 200 && s < 400,
        });
        const meta = await probe(res.data);
        width = meta.width || null;
        height = meta.height || null;
        contentType =
          contentType || meta.type ? `image/${meta.type}` : contentType;
        if (MIN_WIDTH > 0 && width && width < MIN_WIDTH) {
          ok = false;
          reason = `too narrow: ${width}px < ${MIN_WIDTH}px`;
        }
        if (ok && !withinAcceptedAspect(width, height)) {
          ok = false;
          reason = `aspect not accepted: ${width}x${height}`;
        }
      } catch (e) {
        ok = false;
        reason = `probe failed: ${e.message}`;
      }
    }
    const score =
      (u.includes(".jpg") || u.includes(".jpeg") ? 1 : 0) +
      sameDomainBoost(articleUrl, u);
    evaluated.push({ url: u, ok, reason, width, height, contentType, score });
  }

  // Prefer ok=true, highest score; fallback to first candidate if none ok
  evaluated.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1; // ok first
    return b.score - a.score;
  });

  const chosen = evaluated.find((e) => e.ok) || evaluated[0];
  if (!chosen) return null;

  if (!chosen.ok) {
    logger.debug(
      "No verified media passed checks; using first candidate anyway",
      {
        articleId: article.id,
        candidate: chosen.url,
        reason: chosen.reason,
      }
    );
  }

  try {
    let media = await upsertMediaAsset("publisher", chosen.url);
    // Optional: mirror to storage and dedupe by hash
    if (storageEnabled) {
      // Respect policy: only mirror publisher media when allowed
      const allowMirror = await canMirrorMediaForArticle(article);
      if (!allowMirror) {
        logger.info(
          "Policy: mirroring not allowed for this article/source; skipping mirror",
          {
            articleId: article.id,
            url: chosen.url,
          }
        );
      } else {
        try {
          const mirrored = await mirrorImageToStorage(chosen.url);
          if (mirrored?.hash) {
            // Try find existing by hash
            const existing = await selectRecords("media_assets", {
              hash: mirrored.hash,
            });
            if (existing && existing[0]) {
              media = existing[0];
            } else {
              // Update current media with storage info and hash
              await updateRecord("media_assets", media.id, {
                storage_path: mirrored.storagePath,
                hash: mirrored.hash,
                width: mirrored.width || undefined,
                height: mirrored.height || undefined,
              });
            }
            // Prefer returning mirrored public URL if present
            if (mirrored.publicUrl) {
              chosen.url = mirrored.publicUrl;
            }
            if (mirrored.width && mirrored.height) {
              chosen.width = chosen.width || mirrored.width;
              chosen.height = chosen.height || mirrored.height;
            }
            if (Array.isArray(mirrored.variants) && mirrored.variants.length) {
              // Persist variant references if table exists
              for (const v of mirrored.variants) {
                try {
                  await insertRecord("media_variants", {
                    media_id: media.id,
                    width: v.width,
                    storage_path: v.storagePath,
                    public_url: v.publicUrl,
                    bytes: v.bytes,
                  });
                } catch (ve) {
                  // ignore if table doesn't exist or pk conflict
                  if (
                    !/duplicate key value|relation .* does not exist/i.test(
                      ve.message || ""
                    )
                  ) {
                    logger.debug("Variant persist skipped", {
                      error: ve.message,
                    });
                  }
                }
              }
            }
          }
        } catch (e) {
          logger.warn("Mirroring failed", {
            url: chosen.url,
            error: e.message,
          });
        }
      }
    }
    // Persist dimensions if we have them and media lacks
    if (
      (chosen.width || chosen.height) &&
      media &&
      (!media.width || !media.height)
    ) {
      try {
        await updateRecord("media_assets", media.id, {
          width: chosen.width,
          height: chosen.height,
        });
      } catch (_) {}
    }
    try {
      await insertRecord("article_media", {
        article_id: article.id,
        media_id: media.id,
        role: "thumbnail",
        position: 0,
      });
    } catch (e) {
      if (!/duplicate key value/.test(e.message || "")) throw e;
    }
    logger.info("Attached media to article", {
      articleId: article.id,
      mediaId: media.id,
      url: chosen.url,
      width: chosen.width,
      height: chosen.height,
      contentType: chosen.contentType,
    });
    return {
      media,
      url: chosen.url,
      width: chosen.width,
      height: chosen.height,
    };
  } catch (e) {
    logger.warn("Failed to attach media", {
      articleId: article.id,
      error: e.message,
    });
    return null;
  }
}
