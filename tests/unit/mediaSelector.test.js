import { extractMetaImagesFromHtml } from "../../src/services/mediaSelector.js";
import { step } from "../testStep.js";

describe("extractMetaImagesFromHtml", () => {
  it("picks og:image and twitter:image and sorts by preference", async () => {
    const { html, base } = await step(
      "Given sample HTML with meta images",
      async () => ({
        html: `
      <html><head>
        <meta property="og:image" content="/images/og-large.jpg" />
        <meta name="twitter:image" content="https://cdn.example.com/card.webp" />
        <link rel="image_src" href="/thumb.png" />
        <script type="application/ld+json">{
          "@context":"https://schema.org",
          "@type":"NewsArticle",
          "image": ["/schema1.jpg", {"url":"/schema2.png"}]
        }</script>
      </head><body></body></html>`,
        base: "https://news.example.com/article/123",
      })
    );
    const urls = await step("When I extract image URLs", async () =>
      extractMetaImagesFromHtml(html, base)
    );
    await step("Then preferred absolute URLs are returned", async () => {
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toMatch(/^https:\/\//);
      expect(urls.some((u) => u.endsWith("og-large.jpg"))).toBe(true);
      expect(urls.some((u) => u.endsWith("schema2.png"))).toBe(true);
    });
  });

  it("filters out svg/gif and data URLs", async () => {
    const html = `
      <html><head>
        <meta property="og:image" content="data:image/png;base64,AAA" />
        <meta property="og:image" content="/logo.svg" />
        <meta property="og:image" content="/photo.gif" />
      </head></html>`;
    const urls = await step(
      "When I extract from undesirable formats",
      async () => extractMetaImagesFromHtml(html, "https://ex.com")
    );
    await step("Then no URLs remain after filtering", async () => {
      expect(urls.length).toBe(0);
    });
  });
});
