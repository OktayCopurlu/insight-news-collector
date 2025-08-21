import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/gemini.js", () => ({
  generateAIContent: vi.fn(async (prompt) => {
    const frag = String(prompt).split("Input HTML:")[1]?.trim() ?? "";
    return frag;
  }),
}));

import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";
import { makeDb, SAMPLE_URL } from "./helpers.mjs";

function repeatChar(ch, n) {
  return new Array(n + 1).join(ch);
}

describe("huge blocks are chunked and preserved", () => {
  it("30k pre split + long p split", async () => {
    const longText = repeatChar("x", 30000);
    const rawHtml = `<pre>${longText}</pre>\n<p>${repeatChar("y", 12000)}</p>`;

    const db = makeDb();
    const res = await processAndPersistArticle({
      db,
      articleId: "b1",
      rawHtml,
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: ["de"],
    });

    expect(res.results[0].status).toBe("ok");
    const html = db.upserts[0].text;
    expect(html.startsWith("<pre>")).toBe(true);
    expect(html.includes(longText.slice(0, 50))).toBe(true);
    expect(html.includes(longText.slice(-50))).toBe(true);
  });
});
