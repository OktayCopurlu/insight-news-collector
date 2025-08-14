import { jest } from "@jest/globals";

// Mock DB helpers to avoid real Supabase calls in tests
await jest.unstable_mockModule("../../src/config/database.js", () => ({
  selectRecords: async () => [],
  insertRecord: async () => ({}),
}));

// Also mock gemini provider call
await jest.unstable_mockModule("../../src/services/gemini.js", () => ({
  generateAIContent: async (prompt) => {
    // return the last line as "translation" to emulate provider
    const text = prompt.split("\n").slice(2).join("\n");
    return `[xlated] ${text}`;
  },
}));

const { translateText, clearTranslationCache } = await import(
  "../../src/services/translationHelper.js"
);

describe("translationHelper", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, MT_PROVIDER: "gemini" };
    clearTranslationCache();
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test("returns null when no dstLang", async () => {
    const res = await translateText("Hello", { srcLang: "en", dstLang: "" });
    expect(res).toBeNull();
  });

  test("translates and caches result", async () => {
    const text = "Hello world";
    const res1 = await translateText(text, { srcLang: "en", dstLang: "tr" });
    expect(res1).toContain("[xlated]");
    const res2 = await translateText(text, { srcLang: "en", dstLang: "tr" });
    expect(res2).toBe(res1); // cache hit
  });
});
