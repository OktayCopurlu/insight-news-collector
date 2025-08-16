// Moved to _reserved: unused helper kept for reference.
// If you need this again, move it back to src/services and wire where needed.
import { translateText } from "../services/translationHelper.js";

// Translate image alt/caption when needed; returns object with fields if translated or original if not.
async function _translateMediaText({ alt, caption, srcLang, dstLang }) {
  if (!dstLang) return { alt, caption, isTranslated: false };
  const out = { alt, caption, isTranslated: false };
  const tAlt = alt ? await translateText(alt, { srcLang, dstLang }) : null;
  const tCap = caption
    ? await translateText(caption, { srcLang, dstLang })
    : null;
  if (tAlt) {
    out.alt = tAlt;
    out.isTranslated = true;
  }
  if (tCap) {
    out.caption = tCap;
    out.isTranslated = true;
  }
  return out;
}
