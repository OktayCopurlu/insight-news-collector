import { translateText } from "./translationHelper.js";

// Translate image alt/caption when needed; returns object with fields if translated or original if not.
export async function translateMediaText({ alt, caption, srcLang, dstLang }) {
  if (!dstLang) return { alt, caption, isTranslated: false };
  const out = { alt, caption, isTranslated: false };
  const tAlt = alt ? await translateText(alt, { srcLang, dstLang }) : null;
  const tCap = caption ? await translateText(caption, { srcLang, dstLang }) : null;
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
