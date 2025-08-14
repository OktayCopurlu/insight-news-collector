import { extractUpdateFromArticle } from "../../src/services/updateExtractor.js";

describe("updateExtractor", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      CLUSTER_UPDATE_RULES_ENABLED: "true",
      CLUSTER_UPDATE_STANCE_MODE: "off",
    };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });
  test("detects contradicts in EN", async () => {
    const article = {
      title: "Ronaldo rejects Arsenal offer",
      snippet: "Short",
      language: "en",
    };
    const upd = await extractUpdateFromArticle(article);
    expect(upd.stance).toBe("contradicts");
    expect(upd.claim).toMatch(/Ronaldo/);
  });

  test("detects supports in EN", async () => {
    const article = {
      title: "Club confirms official signing",
      snippet: "Short",
      language: "en",
    };
    const upd = await extractUpdateFromArticle(article);
    expect(upd.stance).toBe("supports");
  });

  test("detects contradicts in TR", async () => {
    const article = {
      title: "Ronaldo teklifi reddetti",
      snippet: "Kısa",
      language: "tr",
    };
    const upd = await extractUpdateFromArticle(article);
    expect(upd.stance).toBe("contradicts");
  });

  test("falls back to neutral", async () => {
    const article = {
      title: "Transfer talks ongoing",
      snippet: "Short",
      language: "en",
    };
    const upd = await extractUpdateFromArticle(article);
    expect(upd.stance).toBe("neutral");
  });
});
