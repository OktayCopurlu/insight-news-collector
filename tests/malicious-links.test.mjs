import { describe, it, expect, vi } from "vitest";

vi.mock("../src/services/gemini.js", () => ({
  generateAIContent: vi.fn(async (prompt) => {
    const parts = String(prompt).split("Input HTML:");
    const frag = parts[1] ? parts[1].trim() : "";
    return frag;
  }),
}));

import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";
import { makeDb, SAMPLE_URL } from "./helpers.mjs";

describe("malicious links", () => {
  it("javascript/data/protocol-relative/relative/# handling", async () => {
    const rawHtml = `
      <p>
        <a href="javascript:alert(1)">js</a>
        <a href="data:text/html;base64,AAAA">data</a>
        <a href="//evil.com/x">proto-rel</a>
        <a href="/rel">rel</a>
        <a href="#">empty</a>
      </p>`;

    const db = makeDb();
    const res = await processAndPersistArticle({
      db,
      articleId: "a1",
      rawHtml,
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: ["de"],
    });

    expect(res.results[0].status).toBeTypeOf("string");
    const html = db.upserts[0].text;
    // unsafe anchors become plain text (no <a>, no <span> wrapping expected)
    expect(html).not.toContain('<a href="javascript:');
    expect(html).toContain("js");
    expect(html).not.toContain('<a href="data:');
    expect(html).toContain("data");
    expect(html).toMatch(
      /href="https?:\/\/evil\.com\/x"|<span>proto-rel<\/span>/
    );
    expect(html).toContain('<a href="/rel" rel="nofollow">rel</a>');
    // '#' becomes plain text
    expect(html).not.toContain('<a href="#">empty</a>');
    expect(html).toContain(" empty ");
  });
});
