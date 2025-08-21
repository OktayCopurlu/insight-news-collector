import { JSDOM } from "jsdom";
import { createHash } from "crypto";
import { createContextLogger } from "../config/logger.js";
import { supabase } from "../config/database.js";
import { normalizeBcp47 } from "../utils/lang.js";
import { generateAIContent } from "./gemini.js";
import { assignClusterForArticle } from "./clusterer.js";
import { selectAttachBestImage } from "./mediaSelector.js";

const logger = createContextLogger("ContentPipelineGemini");

const DEFAULT_SOURCE_LANG = normalizeBcp47(
  process.env.DEFAULT_SOURCE_LANG || "auto"
);

// Small allowlist of tags to keep; everything else is unwrapped or removed
const ALLOWED_TAGS = new Set([
  "h2",
  "h3",
  "p",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "ul",
  "ol",
  "li",
  "br",
  // richer blocks (optional)
  "blockquote",
  "pre",
  "code",
  // minimal table support
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

const ALLOWED_ANCHOR_ATTRS = new Set(["href", "rel", "target"]);
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

// In-memory cache for default target langs (5-minute TTL)
let _langsCache = { at: 0, langs: [] };

// Max allowed size for cleaned HTML persisted to DB (bytes)
const MAX_CLEANED_BYTES = parseInt(
  process.env.MAX_CLEANED_BYTES || "512000",
  10
);

function sha256(s) {
  return createHash("sha256")
    .update(s || "", "utf8")
    .digest("hex");
}

function isRelativeUrl(href) {
  return (
    typeof href === "string" &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) &&
    !href.startsWith("//")
  );
}

function sanitizeHref(href, baseUrl) {
  try {
    if (!href) return "#";
    if (href.startsWith("#")) return href;
    // protocol-relative → prefer https, fallback http
    if (href.startsWith("//")) {
      const httpsURL = `https:${href}`;
      try {
        const u = new URL(httpsURL);
        return u.toString();
      } catch (e) {
        void e;
      }
      return `http:${href}`;
    }
    const rel = isRelativeUrl(href);
    const u = new URL(href, baseUrl || "http://localhost");
    if (!SAFE_URL_PROTOCOLS.has(u.protocol)) return "#";
    return rel ? href : u.toString();
  } catch {
    return "#";
  }
}

function removeDisallowedAttributes(el, { baseUrl } = {}) {
  const tag = el.tagName.toLowerCase();
  // Strip event handlers and common noisy attrs universally first
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) el.removeAttribute(attr.name);
    if (
      name === "style" ||
      name === "id" ||
      name === "class" ||
      name.startsWith("data-")
    ) {
      el.removeAttribute(attr.name);
    }
  }

  if (tag === "a") {
    for (const attr of [...el.attributes]) {
      if (!ALLOWED_ANCHOR_ATTRS.has(attr.name.toLowerCase()))
        el.removeAttribute(attr.name);
    }
    const origHref = el.getAttribute("href") || "";
    const safe = sanitizeHref(origHref, baseUrl);
    if (!safe || safe === "#") {
      // href güvenli değilse linkliği kaldır, sadece metin bırak
      const text = el.textContent;
      const span = el.ownerDocument.createElement("span");
      span.textContent = (text || "").trim();
      el.replaceWith(span);
      return;
    }
    el.setAttribute("href", safe);
    if ((el.getAttribute("target") || "").toLowerCase() === "_blank") {
      el.setAttribute("rel", "noopener noreferrer nofollow");
    } else {
      // istersen tüm linklere nofollow
      el.setAttribute("rel", "nofollow");
    }
    return;
  }
  // Preserve useful table semantics on cells
  const keep = new Set(["colspan", "rowspan", "scope", "headers"]);
  if (tag === "td" || tag === "th") {
    for (const attr of [...el.attributes]) {
      if (!keep.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }
    return;
  }
  // Remove all remaining attributes for non-anchors
  for (const attr of [...el.attributes]) {
    el.removeAttribute(attr.name);
  }
}

function unwrapNode(node) {
  while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
  node.remove();
}

function textify(node) {
  return (node.textContent || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeWhitespaceInPlace(el, document) {
  const tw = document.createTreeWalker(
    el,
    document.defaultView.NodeFilter.SHOW_TEXT
  );
  const nodes = [];
  while (tw.nextNode()) nodes.push(tw.currentNode);
  for (const n of nodes) {
    n.nodeValue = (n.nodeValue || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ");
  }
  if (!el.textContent || !el.textContent.trim()) el.remove();
}

function cleanHtml(rawHtml, { baseUrl } = {}) {
  let dom;
  try {
    dom = new JSDOM(`<body>${rawHtml || ""}</body>`, {
      runScripts: "outside-only",
      resources: "usable",
      url: baseUrl || "about:blank",
    });
    const { document } = dom.window;

    // Fixup 1: Keep useful figcaptions as paragraphs, then drop figure
    document.querySelectorAll("figure").forEach((fig) => {
      try {
        const cap = fig.querySelector("figcaption");
        const txt = (cap && cap.textContent && cap.textContent.trim()) || "";
        if (txt) {
          const p = document.createElement("p");
          p.textContent = txt;
          fig.parentNode && fig.parentNode.insertBefore(p, fig.nextSibling);
        }
        fig.remove();
      } catch (_) {
        // ignore malformed figures
      }
    });

    // Inject alt text for images, then remove images
    document.querySelectorAll("img[alt]").forEach((img) => {
      try {
        const alt = img.getAttribute("alt")?.trim();
        if (alt) {
          const p = document.createElement("p");
          p.textContent = alt;
          img.parentNode && img.parentNode.insertBefore(p, img.nextSibling);
        }
        img.remove();
      } catch (e) {
        void e;
      }
    });

    // Remove scripts/styles/iframes/forms/ads etc.
    const REMOVE = [
      "script",
      "style",
      "noscript",
      "iframe",
      "form",
      "header",
      "footer",
      "nav",
      "aside",
      "svg",
      "canvas",
      "figure",
      "picture",
      "video",
      "audio",
    ].join(",");
    document.querySelectorAll(REMOVE).forEach((n) => n.remove());

    // Convert headings: h1->h2, h4-6 -> h3
    document.querySelectorAll("h1").forEach((h1) => {
      const h2 = document.createElement("h2");
      h2.innerHTML = h1.innerHTML;
      h1.replaceWith(h2);
    });
    ["h4", "h5", "h6"].forEach((sel) => {
      document.querySelectorAll(sel).forEach((h) => {
        const h3 = document.createElement("h3");
        h3.innerHTML = h.innerHTML;
        h.replaceWith(h3);
      });
    });

    // Ensure paragraphs exist: wrap stray text nodes under body into <p>
    const body = document.body;
    const newChildren = [];
    for (const node of [...body.childNodes]) {
      if (node.nodeType === 3) {
        // text node
        const t = textify(node);
        if (t) {
          const p = document.createElement("p");
          p.textContent = t;
          newChildren.push(p);
        }
      } else if (node.nodeType === 1) {
        newChildren.push(node);
      }
    }
    if (newChildren.length) {
      body.innerHTML = "";
      newChildren.forEach((n) => body.appendChild(n));
    }

    // Fixup 2: Wrap orphan <li> into a simple <ul>
    body.querySelectorAll("li").forEach((li) => {
      if (!li.closest("ul,ol")) {
        const ul = document.createElement("ul");
        li.replaceWith(ul);
        ul.appendChild(li);
      }
    });

    // Walk DOM: unwrap or remove non-allowed tags, cleanup attributes
    const walker = document.createTreeWalker(body, 1 /* ELEMENT_NODE */);
    const toProcess = [];
    while (walker.nextNode()) toProcess.push(walker.currentNode);
    for (const el of toProcess) {
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        if (["div", "span", "section", "article"].includes(tag)) {
          unwrapNode(el);
        } else {
          // Replace with its text content inside a paragraph to avoid losing text
          const t = textify(el);
          if (t) {
            const p = document.createElement("p");
            p.textContent = t;
            el.replaceWith(p);
          } else {
            el.remove();
          }
        }
        continue;
      }
      // Normalize <b>/<i> first to semantic equivalents
      if (tag === "b") {
        const strong = document.createElement("strong");
        strong.innerHTML = el.innerHTML;
        el.replaceWith(strong);
        continue;
      } else if (tag === "i") {
        const em = document.createElement("em");
        em.innerHTML = el.innerHTML;
        el.replaceWith(em);
        continue;
      }
      removeDisallowedAttributes(el, { baseUrl });
      if (["p", "h2", "h3", "li", "blockquote"].includes(tag)) {
        normalizeWhitespaceInPlace(el, document);
      }
    }

    // Serialize cleaned HTML
    const blocks = [];
    for (const el of [...body.children]) {
      const tag = el.tagName.toLowerCase();
      if (
        ["h2", "h3", "p", "ul", "ol", "blockquote", "pre", "table"].includes(
          tag
        )
      ) {
        blocks.push(el.outerHTML);
      }
    }
    return blocks.join("\n");
  } catch (e) {
    logger.warn("HTML clean failed, returning plain text wrapped in <p>", {
      error: e.message,
    });
    const txt = String(rawHtml || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return txt ? `<p>${txt}</p>` : "";
  } finally {
    try {
      dom?.window?.close();
    } catch (e) {
      void e;
    }
  }
}

function splitBlocksForTranslation(html) {
  // DOM-aware split: return each top-level element's outerHTML as a block
  let dom;
  try {
    dom = new JSDOM(`<body>${html || ""}</body>`, {
      runScripts: "outside-only",
      resources: "usable",
      url: "about:blank",
    });
    const { document } = dom.window;
    return [...document.body.children].map((c) => c.outerHTML);
  } catch (e) {
    // Fallback to newline split if DOM parse fails
    return (html || "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  } finally {
    try {
      dom?.window?.close();
    } catch (e) {
      void e;
    }
  }
}

function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const fn = queue.shift();
    Promise.resolve()
      .then(fn)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      const run = () => fn().then(resolve, reject);
      queue.push(run);
      next();
    });
}

const MAX_HTML_BLOCK_CHARS = parseInt(
  process.env.LLM_BLOCK_MAX_CHARS || "8000",
  10
);

// Concurrency controls (tunable via ENV)
const TRANSLATE_BLOCK_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.LLM_BLOCK_CONCURRENCY || "3", 10)
);
const TRANSLATE_LANG_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.LLM_LANG_CONCURRENCY || "2", 10)
);

function splitBlockByChildren(blockHtml, maxChars) {
  if (!blockHtml || blockHtml.length <= maxChars) return [blockHtml];
  let dom;
  try {
    dom = new JSDOM(`<body>${blockHtml}</body>`, {
      runScripts: "outside-only",
      resources: "usable",
      url: "about:blank",
    });
    const { document } = dom.window;
    const el = document.body.firstElementChild;
    if (!el) return [blockHtml];
    const tag = el.tagName.toLowerCase();
    // For pre/code: split by lines roughly within limit
    if (tag === "pre" || tag === "code") {
      const text = el.textContent || "";
      const lines = text.split(/\n/);
      const chunks = [];
      let buf = [];
      let size = 0;
      const wrapOverhead = tag.length * 2 + 5; // <tag> + </tag>
      const limit = Math.max(2000, maxChars - wrapOverhead);
      for (const ln of lines) {
        const add = (ln + "\n").length;
        if (size + add > limit && buf.length) {
          chunks.push(buf.join("\n"));
          buf = [ln];
          size = ln.length + 1;
        } else {
          buf.push(ln);
          size += add;
        }
      }
      if (buf.length) chunks.push(buf.join("\n"));
      return chunks.map((txt) => `<${tag}>${txt}</${tag}>`);
    }
    // General case: group childNodes into multiple wrappers under char budget
    const parts = [];
    let group = [];
    let acc = 0;
    const children = [...el.childNodes];
    const wrapLen = el.tagName.length * 2 + 5;
    const limit = Math.max(2000, maxChars - wrapLen);
    const serializeNodes = (nodes) => {
      const frag = document.createElement(el.tagName.toLowerCase());
      nodes.forEach((n) => frag.appendChild(n.cloneNode(true)));
      return frag.outerHTML;
    };
    for (const n of children) {
      const s = n.outerHTML || n.textContent || "";
      const len = s.length;
      if (len > limit) {
        // Fallback: flush current group then push this node alone (may still exceed limit)
        if (group.length) {
          parts.push(serializeNodes(group));
          group = [];
          acc = 0;
        }
        parts.push(serializeNodes([n]));
        continue;
      }
      if (acc + len > limit && group.length) {
        parts.push(serializeNodes(group));
        group = [n];
        acc = len;
      } else {
        group.push(n);
        acc += len;
      }
    }
    if (group.length) parts.push(serializeNodes(group));
    return parts.length ? parts : [blockHtml];
  } catch (_) {
    return [blockHtml];
  } finally {
    try {
      dom?.window?.close();
    } catch (e) {
      void e;
    }
  }
}

async function translateHtmlPreserve(html, { srcLang, dstLang }) {
  const src = normalizeBcp47(srcLang || DEFAULT_SOURCE_LANG);
  const dst = normalizeBcp47(dstLang);
  if (!dst) return "";
  const norm = (l) => String(l || "").split("-")[0];
  if (norm(src) === norm(dst)) return html;
  const blocks = splitBlocksForTranslation(html);
  const skipRe = /<(pre|code)(\s|>)/i;
  const expandedBlocks = blocks.flatMap((b) =>
    skipRe.test(b) ? [b] : splitBlockByChildren(b, MAX_HTML_BLOCK_CHARS)
  );
  const limit = pLimit(TRANSLATE_BLOCK_CONCURRENCY);
  const translatedBlocks = await Promise.all(
    expandedBlocks.map((block) =>
      limit(async () => {
        if (skipRe.test(block)) return block;
        const instruction = [
          `Translate from ${src} to ${dst}.`,
          "Preserve ALL HTML tags and attributes exactly; only translate visible text.",
          "Do not add or remove tags. Return HTML only for the given fragment.",
          "Input HTML:",
          block,
        ].join("\n");
        try {
          const approxTokens = Math.ceil(block.length / 4);
          const maxOut = Math.min(
            4096,
            Math.max(512, Math.ceil(approxTokens * 1.2))
          );
          const translated = await generateAIContent(instruction, {
            maxOutputTokens: maxOut,
            temperature: 0.2,
            attempts: 2,
          });
          const out = String(translated || "")
            .replace(/^```[a-zA-Z0-9]*\n?/, "")
            .replace(/```\s*$/, "")
            .trim();
          if (!out) return ""; // guard empty
          return out;
        } catch (e) {
          logger.warn(
            "Block translation failed; falling back to original block",
            {
              error: e.message,
            }
          );
          return block;
        }
      })
    )
  );
  return translatedBlocks.filter(Boolean).join("\n");
}

export async function loadDefaultTargetLangs() {
  const now = Date.now();
  // 5 minutes TTL cache
  if (now - _langsCache.at < 5 * 60 * 1000 && _langsCache.langs.length) {
    return _langsCache.langs;
  }
  // Try to derive from app_markets.show_langs or PRETRANSLATE_LANGS env; fallback empty
  const envList = (
    process.env.PRETRANSLATE_LANGS ||
    process.env.TARGET_LANGS ||
    ""
  ).trim();
  if (envList) {
    const result = envList
      .split(/[\s,]+/)
      .map((s) => normalizeBcp47(s))
      .filter(Boolean);
    _langsCache = { at: now, langs: result };
    return result;
  }
  try {
    const { data, error } = await supabase
      .from("app_markets")
      .select("show_langs");
    if (error) throw error;
    const parse = (raw) =>
      String(raw || "")
        .replace(/[{}]/g, "")
        .split(/[\s,]+/)
        .map((s) => normalizeBcp47(s))
        .filter(Boolean);
    const set = new Set();
    for (const row of data || [])
      parse(row.show_langs).forEach((l) => set.add(l));
    const result = [...set];
    _langsCache = { at: now, langs: result };
    return result;
  } catch (_) {
    _langsCache = { at: now, langs: [] };
    return [];
  }
}

export async function processAndPersistArticle({
  db,
  articleId,
  rawHtml,
  url,
  sourceLang,
  targetLangs,
}) {
  if (!articleId) throw new Error("articleId is required");
  const src = normalizeBcp47(sourceLang || DEFAULT_SOURCE_LANG);
  const dbClient = db || {
    articles: {
      update: (id, fields) =>
        supabase.from("articles").update(fields).eq("id", id),
    },
    translations: {
      upsert: (row, opts) =>
        supabase
          .from("translations")
          .upsert(row, opts || { onConflict: "key" }),
    },
  };

  // 1) Clean original HTML and persist to articles.full_text
  const cleanedHtml = cleanHtml(rawHtml || "", { baseUrl: url });
  const cleanedBytes = Buffer.byteLength(cleanedHtml || "", "utf8");
  const cleanedHash = sha256(cleanedHtml || "");
  if (cleanedBytes > MAX_CLEANED_BYTES) {
    logger.warn("Cleaned HTML exceeds MAX_CLEANED_BYTES", {
      articleId,
      bytes: cleanedBytes,
      limit: MAX_CLEANED_BYTES,
    });
  }
  {
    const q = dbClient.articles.update(articleId, { full_text: cleanedHtml });
    let res;
    try {
      res = q && typeof q.select === "function" ? await q.select() : await q;
    } catch (e) {
      res = { error: e };
    }

    // Minimal clustering (env-gated) to keep BFF /feed working without changes
    try {
      const minimalEnabled = (process.env.CLUSTER_MINIMAL_ENABLED || "true")
        .toString()
        .toLowerCase();
      if (minimalEnabled === "true") {
        const { data: artRow, error: aErr } = await supabase
          .from("articles")
          .select("id,title,snippet,full_text,language,published_at,source_id")
          .eq("id", articleId)
          .maybeSingle();
        if (aErr) throw aErr;
        if (artRow) {
          // Best-effort: attach an image for cards
          try {
            await selectAttachBestImage(artRow);
          } catch (e) {
            logger.debug("image selection skipped", { error: e.message });
          }
          // Force-enable clustering for this call only if not set
          const prev = String(
            process.env.CLUSTERING_ENABLED || ""
          ).toLowerCase();
          if (!prev) process.env.CLUSTERING_ENABLED = "true";
          try {
            const clusterId = await assignClusterForArticle(artRow, {
              sourceId: artRow.source_id || null,
            });
            if (clusterId) {
              // Ensure minimal cluster_ai exists (title/summary)
              try {
                const lang = normalizeBcp47(artRow.language || "en");
                const { data: existing } = await supabase
                  .from("cluster_ai")
                  .select("id")
                  .eq("cluster_id", clusterId)
                  .eq("lang", lang)
                  .eq("is_current", true)
                  .maybeSingle();
                if (!existing) {
                  // Derive a minimal summary: prefer snippet, else first ~280 chars of cleaned text
                  let derivedSummary = (artRow.snippet || "").toString().trim();
                  if (!derivedSummary) {
                    const plain = (cleanedHtml || "")
                      .replace(/<[^>]+>/g, " ")
                      .replace(/\s+/g, " ")
                      .trim();
                    derivedSummary = plain.slice(0, 280);
                  }
                  await supabase.from("cluster_ai").insert({
                    cluster_id: clusterId,
                    lang,
                    ai_title: artRow.title || "(untitled)",
                    ai_summary: derivedSummary || artRow.title || "",
                    ai_details: artRow.snippet || artRow.title || "",
                    model: `${process.env.LLM_MODEL || "stub"}#seed=minimal`,
                    is_current: true,
                  });
                }
              } catch (e) {
                logger.debug("minimal cluster_ai skipped", {
                  error: e.message,
                });
              }
            }
          } catch (e) {
            logger.debug("cluster assign skipped", { error: e.message });
          } finally {
            if (!prev) delete process.env.CLUSTERING_ENABLED;
          }
        }
      }
    } catch (e) {
      logger.debug("post-persist clustering skipped", { error: e.message });
    }
    if (res?.error) {
      logger.warn("Failed to update articles.full_text", {
        error: res.error.message || String(res.error),
        articleId,
      });
    }
  }

  // 2) Decide target languages
  const defaults = await loadDefaultTargetLangs();
  const targets = (targetLangs && targetLangs.length ? targetLangs : defaults)
    .map((l) => normalizeBcp47(l))
    .filter(Boolean);
  const norm = (l) => (l || "").split("-")[0];
  const uniqueTargets = [...new Set(targets)].filter(
    (l) => norm(l) !== norm(src)
  );

  // 3) Translate per target and upsert into public.translations
  const results = [];
  const limitLang = pLimit(TRANSLATE_LANG_CONCURRENCY);
  await Promise.all(
    uniqueTargets.map((lang) =>
      limitLang(async () => {
        const key = `article:${articleId}:full_text:${lang}`;
        try {
          const translatedHtml = await translateHtmlPreserve(cleanedHtml, {
            srcLang: src,
            dstLang: lang,
          });
          if (!translatedHtml) {
            results.push({ lang, status: "skipped", reason: "empty_output" });
            return;
          }
          const safeTranslatedHtml = sanitizeHtmlFragment(translatedHtml, {
            baseUrl: url,
          });
          if (!safeTranslatedHtml) {
            results.push({
              lang,
              status: "skipped",
              reason: "sanitized_empty",
            });
            return;
          }
          const finalHtml = isRTL(lang)
            ? safeTranslatedHtml.replace(
                /<(p|h2|h3|ul|ol|table)\b/gi,
                '<$1 dir="rtl"'
              )
            : safeTranslatedHtml;
          const upsertRes = await dbClient.translations.upsert(
            {
              key,
              src_lang: src,
              dst_lang: lang,
              text: finalHtml,
            },
            { onConflict: "key" }
          );
          const upsertErr = upsertRes?.error;
          if (upsertErr) {
            logger.warn("Translation upsert failed", {
              articleId,
              lang,
              error: upsertErr.message,
            });
            results.push({
              lang,
              status: "error",
              reason: "db_upsert_error",
              error: upsertErr.message,
            });
            return;
          }
          results.push({ lang, status: "ok" });
        } catch (e) {
          logger.warn("Translation upsert failed", {
            articleId,
            lang,
            error: e.message,
          });
          results.push({
            lang,
            status: "error",
            reason: "unexpected_error",
            error: e.message,
          });
        }
      })
    )
  );

  return {
    articleId,
    sourceLang: src,
    url: url || null,
    cleanedBytes,
    cleanedHash,
    targets: uniqueTargets,
    results,
  };
}

function sanitizeHtmlFragment(html, { baseUrl } = {}) {
  let dom;
  dom = new JSDOM(`<body>${html || ""}</body>`, {
    runScripts: "outside-only",
    resources: "usable",
    url: baseUrl || "about:blank",
  });
  const { document } = dom.window;
  // Orphan <li> fix here as well to avoid stray items
  document.querySelectorAll("li").forEach((li) => {
    if (!li.closest("ul,ol")) {
      const ul = document.createElement("ul");
      li.replaceWith(ul);
      ul.appendChild(li);
    }
  });
  const walker = document.createTreeWalker(document.body, 1 /* ELEMENT_NODE */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const el of nodes) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (["div", "span", "section", "article"].includes(tag)) {
        unwrapNode(el);
      } else {
        const t = textify(el);
        if (t) {
          const p = document.createElement("p");
          p.textContent = t;
          el.replaceWith(p);
        } else {
          el.remove();
        }
      }
      continue;
    }
    removeDisallowedAttributes(el, { baseUrl });
    if (["p", "h2", "h3", "li", "blockquote", "td", "th"].includes(tag)) {
      normalizeWhitespaceInPlace(el, document);
    }
  }
  const parts = [...document.body.children].map((c) => c.outerHTML).join("\n");
  // Guard: empty after sanitize
  if (
    !parts ||
    !String(parts)
      .replace(/<[^>]+>/g, "")
      .trim()
  )
    return "";
  try {
    return parts;
  } finally {
    try {
      dom?.window?.close();
    } catch (e) {
      void e;
    }
  }
}

function isRTL(lang) {
  return /^(ar|fa|he|ur)(-|$)/i.test(lang || "");
}
