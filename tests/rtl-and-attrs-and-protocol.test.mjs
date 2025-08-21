import { describe, it, expect } from "vitest";
import { makeDb, SAMPLE_URL } from "./helpers.mjs";
import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";

// Basic tests for: td/th attrs kept, protocol-relative to https, rtl dir added.
describe("content pipeline improvements", () => {
  it("preserves td/th colspan/rowspan and upgrades protocol-relative hrefs", async () => {
    const raw = `
      <table><tr>
        <th scope="col">H</th>
        <td colspan="2"><a href="//example.com/x">Link</a></td>
      </tr></table>`;
    const updates = [];
    const db = makeDb({
      updates,
      articles: {
        update: (id, payload) => ({
          select: async () => {
            updates.push(payload);
            return { data: [{}], error: null };
          },
        }),
      },
    });
    const res = await processAndPersistArticle({
      db,
      articleId: "t1",
      rawHtml: raw,
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: [], // skip translation for this test
    });
    expect(res.cleanedBytes).toBeGreaterThan(0);
    const html = updates[0]?.full_text || "";
    expect(html).toContain('<th scope="col">');
    expect(html).toContain('<td colspan="2">');
    expect(html).toContain('href="https://example.com/x"');
  });

  it("adds dir=rtl for rtl languages in final translated html", async () => {
    const raw = `<p>Hello world</p>`;
    const upserts = [];
    const db = makeDb({
      upserts,
      translations: {
        upsert: async (row) => {
          upserts.push(row);
          return { data: row, error: null };
        },
      },
    });
    await processAndPersistArticle({
      db,
      articleId: "t2",
      rawHtml: raw,
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: ["ar"],
    });
    const ar = upserts.find((u) => u.dst_lang === "ar");
    expect(ar).toBeTruthy();
    expect(ar.text).toMatch(/<p[^>]*dir="rtl"/);
  });
});
