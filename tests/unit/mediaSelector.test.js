import { extractMetaImagesFromHtml } from "../../src/services/mediaSelector.js";

describe("extractMetaImagesFromHtml", () => {
  it("picks og:image and twitter:image and sorts by preference", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/images/og-large.jpg" />
        <meta name="twitter:image" content="https://cdn.example.com/card.webp" />
        <link rel="image_src" href="/thumb.png" />
        <script type="application/ld+json">{
          "@context":"https://schema.org",
          "@type":"NewsArticle",
          "image": ["/schema1.jpg", {"url":"/schema2.png"}]
        }</script>
      </head><body></body></html>`;
    const base = "https://news.example.com/article/123";
    const urls = extractMetaImagesFromHtml(html, base);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toMatch(/^https:\/\//);
    expect(urls.some((u) => u.endsWith("og-large.jpg"))).toBe(true);
    expect(urls.some((u) => u.endsWith("schema2.png"))).toBe(true);
  });

  it("filters out svg/gif and data URLs", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="data:image/png;base64,AAA" />
        <meta property="og:image" content="/logo.svg" />
        <meta property="og:image" content="/photo.gif" />
      </head></html>`;
    const urls = extractMetaImagesFromHtml(html, "https://ex.com");
    expect(urls.length).toBe(0);
  });
});
