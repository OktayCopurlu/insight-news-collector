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
import { step } from "../testStep.js";

describe("utils/helpers", () => {
  test("generateContentHash is deterministic and length 16", async () => {
    await step("Given I have the same title and snippet", async () => {
      const h1 = generateContentHash("Title", "Snippet");
      const h2 = generateContentHash("Title", "Snippet");
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(16);
    });
  });

  test("sanitizeText removes control chars and trims", async () => {
    await step("When I sanitize a string with newlines and tabs", async () => {
      const cleaned = sanitizeText("  Hello\nWorld\t");
      expect(cleaned).toBe("HelloWorld");
    });
  });

  test("isValidUrl / extractDomain", async () => {
    await step("Then URL validation and domain extraction behave", async () => {
      expect(isValidUrl("https://example.com/path")).toBe(true);
      expect(extractDomain("https://sub.example.com/thing")).toBe(
        "sub.example.com"
      );
      expect(isValidUrl("not a url")).toBe(false);
    });
  });

  test("chunk splits array correctly", async () => {
    await step("When I chunk an array by size 2", async () => {
      const arr = [1, 2, 3, 4, 5];
      expect(chunk(arr, 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
  });

  test("parseBoolean handles strings and numbers", async () => {
    await step("Then booleans are parsed from strings and numbers", async () => {
      expect(parseBoolean("true")).toBe(true);
      expect(parseBoolean("FALSE")).toBe(false);
      expect(parseBoolean(1)).toBe(true);
      expect(parseBoolean(0)).toBe(false);
    });
  });

  test("truncateText adds ellipsis when exceeding length", async () => {
    await step("Then long text is truncated with ellipsis", async () => {
      const res = truncateText("abcdefghij", 8);
      expect(res).toBe("abcde...");
    });
  });

  test("normalizeLanguageCode maps and defaults", async () => {
    await step("Then language codes are normalized", async () => {
      expect(normalizeLanguageCode("EN-us")).toBe("en");
      expect(normalizeLanguageCode("pt-BR")).toBe("pt");
      expect(normalizeLanguageCode("xx")).toBe("en");
    });
  });

  test("createRateLimiter enforces window", async () => {
    await step("Given limiter of 2 per 100ms, Then third call is blocked and resets after window", async () => {
      const allow = createRateLimiter(2, 100); // 2 per 100ms
      expect(allow("k")).toBe(true);
      expect(allow("k")).toBe(true);
      expect(allow("k")).toBe(false);
      await new Promise((r) => setTimeout(r, 120));
      expect(allow("k")).toBe(true); // window reset
    });
  });
});
