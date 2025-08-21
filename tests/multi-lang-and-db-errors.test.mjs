import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/gemini.js", () => ({
  generateAIContent: vi.fn(async (prompt) => {
    const frag = String(prompt).split("Input HTML:")[1]?.trim() ?? "";
    return frag || "<p></p>";
  }),
}));

import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";
import { makeDb, SAMPLE_URL } from "./helpers.mjs";

describe("multi-language root filtering + db errors + sanitized empty", () => {
  it("filters same-root lang and surfaces db errors", async () => {
    const db = makeDb({
      translations: {
        upsert: async () => ({ error: new Error("fail upsert") }),
      },
    });
    const res = await processAndPersistArticle({
      db,
      articleId: "d1",
      rawHtml: "<p>Hello</p>",
      url: SAMPLE_URL,
      sourceLang: "en-US",
      targetLangs: ["en-GB", "de", "zh-CN"],
    });
    // en-GB filtered; only de and zh-CN attempted
    expect(res.targets).toEqual(["de", "zh-CN"]);
    expect(res.results.length).toBe(2);
    expect(res.results[0].status).toBe("error");
    expect(["db_upsert_error", "unexpected_error"]).toContain(
      res.results[0].reason
    );
  });

  it("sanitized empty yields skipped/sanitized_empty", async () => {
    const { generateAIContent } = await import("../src/services/gemini.js");
    // Return a fragment that sanitizes to empty (no visible text)
    generateAIContent.mockResolvedValueOnce('<iframe src="x"></iframe>');
    const db = makeDb();
    const res = await processAndPersistArticle({
      db,
      articleId: "d2",
      rawHtml: "<p>Hi</p>",
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: ["de"],
    });
    expect(res.results[0]).toMatchObject({
      status: "skipped",
      reason: "sanitized_empty",
    });
  });
});
