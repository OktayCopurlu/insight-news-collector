import crypto from "crypto";

export const generateContentHash = (title = "", snippet = "") => {
  const content = `${title}${snippet}`.trim();
  return crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .substring(0, 16);
};

// (removed) _generateUUID was unused

export const sanitizeText = (text) => {
  if (!text) return "";
  // Remove ASCII control chars (U+0000..U+001F, U+007F) without regex literals
  const cleaned = String(text)
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return cleaned.replace(/\s+/g, " ").trim().substring(0, 5000);
};

export const isValidUrl = (string) => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};

export const extractDomain = (url) => {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return null;
  }
};

// (removed) sleep/_retry were unused

export const chunk = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

// (removed) _formatDate was unused

export const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return Boolean(value);
};

// (removed) _validateEmail was unused

export const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;

  return text.substring(0, maxLength - 3) + "...";
};

export const normalizeLanguageCode = (lang) => {
  if (!lang) return "en";

  // Convert to lowercase and take first 2 characters
  const normalized = lang.toLowerCase().substring(0, 2);

  // Map common variations
  const langMap = {
    en: "en",
    es: "es",
    fr: "fr",
    de: "de",
    it: "it",
    pt: "pt",
    ru: "ru",
    zh: "zh",
    ja: "ja",
    ko: "ko",
    ar: "ar",
  };

  return langMap[normalized] || "en";
};

export const createRateLimiter = (maxRequests, windowMs) => {
  const requests = new Map();

  return (key) => {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old requests
    if (requests.has(key)) {
      requests.set(
        key,
        requests.get(key).filter((time) => time > windowStart)
      );
    } else {
      requests.set(key, []);
    }

    const requestTimes = requests.get(key);

    if (requestTimes.length >= maxRequests) {
      return false; // Rate limit exceeded
    }

    requestTimes.push(now);
    return true; // Request allowed
  };
};
