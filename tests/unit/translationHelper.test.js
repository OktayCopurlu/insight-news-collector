import { jest } from "@jest/globals";
import { step } from "../testStep.js";

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
    const res = await step(
      "When dstLang is empty, translateText returns null",
      async () => translateText("Hello", { srcLang: "en", dstLang: "" })
    );
    await step("Then result is null", async () => {
      expect(res).toBeNull();
    });
  });

  test("translates and caches result", async () => {
    const text = "Hello world";
    const res1 = await step(
      "Given a first translation, it is computed",
      async () => translateText(text, { srcLang: "en", dstLang: "tr" })
    );
    await step("Then the first result contains provider marker", async () => {
      expect(res1).toContain("[xlated]");
    });
    const res2 = await step(
      "When translating the same text again, cache is used",
      async () => translateText(text, { srcLang: "en", dstLang: "tr" })
    );
    await step("Then cache hit returns identical result", async () => {
      expect(res2).toBe(res1);
    });
  });
});
