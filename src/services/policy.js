import { selectRecords } from "../config/database.js";
import { createContextLogger } from "../config/logger.js";

const logger = createContextLogger("Policy");

const DEFAULT_ALLOW =
  (process.env.MEDIA_MIRROR_DEFAULT_ALLOW || "false").toLowerCase() === "true";

function allowedUseAllowsMirror(allowedUse) {
  if (!allowedUse) return false;
  const s = String(allowedUse).toLowerCase();
  return s.includes("mirror"); // 'mirror' or 'mirror_thumb'
}

export async function canMirrorMediaForArticle(article) {
  try {
    // Check article_policy first
    const pol = await selectRecords("article_policy", {
      article_id: article.id,
    });
    if (pol && pol[0]) {
      const p = pol[0];
      if (p.terms_ok === false || p.robots_ok === false) return false;
      // Extendable: if policy later includes specific media_mirror boolean, honor it here
    }
    // Fallback: check source.allowed_use
    if (article.source_id) {
      const src = await selectRecords("sources", { id: article.source_id });
      if (src && src[0]) {
        const au = src[0].allowed_use;
        if (allowedUseAllowsMirror(au)) return true;
        if (
          String(au || "")
            .toLowerCase()
            .includes("link+snippet")
        )
          return false;
      }
    }
    return DEFAULT_ALLOW;
  } catch (e) {
    logger.warn("Policy check failed; using default", {
      articleId: article.id,
      error: e.message,
      defaultAllow: DEFAULT_ALLOW,
    });
    return DEFAULT_ALLOW;
  }
}
