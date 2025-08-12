import {
  generateContentHash,
  sanitizeText,
  isValidUrl,
  extractDomain,
  chunk,
  parseBoolean,
  truncateText,
  normalizeLanguageCode,
  createRateLimiter,
} from "../../src/utils/helpers.js";

describe("utils/helpers", () => {
  test("generateContentHash is deterministic and length 16", () => {
    const h1 = generateContentHash("Title", "Snippet");
    const h2 = generateContentHash("Title", "Snippet");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  test("sanitizeText removes control chars and trims", () => {
    const cleaned = sanitizeText("  Hello\nWorld\t");
    // Newline and tab are control chars => removed entirely, then spaces collapsed
    expect(cleaned).toBe("HelloWorld");
  });

  test("isValidUrl / extractDomain", () => {
    expect(isValidUrl("https://example.com/path")).toBe(true);
    expect(extractDomain("https://sub.example.com/thing")).toBe(
      "sub.example.com"
    );
    expect(isValidUrl("not a url")).toBe(false);
  });

  test("chunk splits array correctly", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(chunk(arr, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("parseBoolean handles strings and numbers", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("FALSE")).toBe(false);
    expect(parseBoolean(1)).toBe(true);
    expect(parseBoolean(0)).toBe(false);
  });

  test("truncateText adds ellipsis when exceeding length", () => {
    const res = truncateText("abcdefghij", 8);
    expect(res).toBe("abcde...");
  });

  test("normalizeLanguageCode maps and defaults", () => {
    expect(normalizeLanguageCode("EN-us")).toBe("en");
    expect(normalizeLanguageCode("pt-BR")).toBe("pt");
    expect(normalizeLanguageCode("xx")).toBe("en");
  });

  test("createRateLimiter enforces window", async () => {
    const allow = createRateLimiter(2, 100); // 2 per 100ms
    expect(allow("k")).toBe(true);
    expect(allow("k")).toBe(true);
    expect(allow("k")).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(allow("k")).toBe(true); // window reset
  });
});
