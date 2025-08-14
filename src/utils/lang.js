// Minimal BCP-47 normalization and helpers (no deps, non-strict)
// - Lowercase language, uppercase region (en, en-GB, pt-BR)
// - Accept underscores and convert to hyphens
// - Trim and validate basic shape

export function normalizeBcp47(input, fallback = "en") {
  if (!input || typeof input !== "string") return fallback;
  let s = input.trim().replace(/_/g, "-");
  if (!s) return fallback;
  const parts = s.split("-").filter(Boolean);
  if (!parts.length) return fallback;
  const lang = (parts[0] || "").toLowerCase();
  let region = parts[1] && parts[1].length === 2 ? parts[1].toUpperCase() : null;
  // Support scripts like zh-Hans
  const script = parts[1] && parts[1].length === 4 ? capitalize(parts[1]) : null;
  if (script && parts[2] && parts[2].length === 2) {
    region = parts[2].toUpperCase();
  }
  const out = [lang];
  if (script) out.push(script);
  if (region) out.push(region);
  return out.join("-");
}

export function isRtlLang(code) {
  const c = (code || "").toLowerCase();
  return c.startsWith("ar") || c.startsWith("he") || c.startsWith("fa") || c.startsWith("ur");
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
