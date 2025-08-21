import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/gemini.js", () => ({
  generateAIContent: vi.fn(async (prompt) => {
    return String(prompt).split("Input HTML:")[1]?.trim() ?? "";
  }),
}));

import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";
import { makeDb, SAMPLE_URL } from "./helpers.mjs";

describe("figure/table and broken HTML handling", () => {
  it("figcaption preserved, table cells normalized, orphan li wrapped", async () => {
    const rawHtml = `
      <figure><img src="x"/><figcaption> Caption  \t with  spaces </figcaption></figure>
      <table><tbody><tr><th>  A  </th><td>  B   </td></tr></tbody></table>
      <li>Orphan</li>
    `;
    const db = makeDb();
    const res = await processAndPersistArticle({
      db,
      articleId: "c1",
      rawHtml,
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: ["de"],
    });
    expect(res.results[0].status).toBe("ok");
    const html = db.upserts[0].text;
    expect(html).toContain("<p>Caption with spaces</p>");
    expect(html).toMatch(/<th>\s*A\s*<\/th>/);
    expect(html).toMatch(/<td>\s*B\s*<\/td>/);
    expect(html).toMatch(/<ul>\s*<li>Orphan<\/li>\s*<\/ul>/);
  });
});
