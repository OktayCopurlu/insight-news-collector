import { describe, it, expect } from "vitest";
import { makeDb, SAMPLE_URL } from "./helpers.mjs";
import { processAndPersistArticle } from "../src/services/content-pipeline.gemini.js";

// Ensure pre/code blocks are not translated while surrounding text is.
describe("pre/code blocks remain untranslated", () => {
  it("keeps content inside <pre><code> unchanged", async () => {
    const raw = `
      <p>Hello world!</p>
      <pre><code>const a = 42;\nfunction t(x){return x*2}</code></pre>
      <p>Bye.</p>
    `;

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
      articleId: "pc1",
      rawHtml: raw,
      url: SAMPLE_URL,
      sourceLang: "en",
      targetLangs: ["tr"],
    });

    const tr = upserts.find((u) => u.dst_lang === "tr");
    expect(tr).toBeTruthy();
    const html = tr.text;
    expect(html).toContain(
      "<pre><code>const a = 42;\nfunction t(x){return x*2}</code></pre>"
    );
  });
});
