import { jest } from "@jest/globals";
import { step } from "../testStep.js";

// ESM-friendly module mocking: create mocks, then dynamically import subject under test
const mockDb = {
  supabase: { rpc: jest.fn(), from: jest.fn() },
  selectRecords: jest.fn(async () => []),
  insertRecord: jest.fn(async () => ({})),
  updateRecord: jest.fn(async () => ({})),
};

jest.unstable_mockModule("../../src/config/database.js", () => ({
  supabase: mockDb.supabase,
  selectRecords: mockDb.selectRecords,
  insertRecord: mockDb.insertRecord,
  updateRecord: mockDb.updateRecord,
}));

describe("clusterer.assignClusterForArticle", () => {
  const OLD_ENV = process.env;
  let assignClusterForArticle;

  beforeEach(async () => {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      CLUSTERING_ENABLED: "true",
      CLUSTER_TRGM_THRESHOLD: "0.55",
    };
    // reset mocks
    mockDb.supabase.rpc.mockReset();
    mockDb.selectRecords.mockReset();
    mockDb.insertRecord.mockReset();
    mockDb.updateRecord.mockReset();
    mockDb.selectRecords.mockResolvedValue([]);
    mockDb.insertRecord.mockResolvedValue({});
    mockDb.updateRecord.mockResolvedValue({});

    // dynamic import after mocks are set up
    ({ assignClusterForArticle } = await import(
      "../../src/services/clusterer.js"
    ));
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test("reuses existing cluster when similarity candidate has cluster_id", async () => {
    await step("Given a high-similarity candidate with cluster id", async () => {
      mockDb.supabase.rpc.mockResolvedValue({
        data: [
          { article_id: "a1", similarity: 0.9, cluster_id: "cluster-123" },
        ],
        error: null,
      });
    });
    const article = {
      id: "new-1",
      title: "Transfer progresses",
      snippet: "Short",
      full_text: null,
      published_at: new Date().toISOString(),
      language: "en",
    };
    const clusterId = await step("When I assign a cluster", async () =>
      assignClusterForArticle(article, { sourceId: "src1" })
    );
    await step("Then the existing cluster is reused and article is updated", async () => {
      expect(clusterId).toBe("cluster-123");
      expect(mockDb.updateRecord).toHaveBeenCalledWith(
        "articles",
        article.id,
        expect.objectContaining({ cluster_id: "cluster-123" })
      );
    });
  });

  test("creates new cluster when no candidates", async () => {
    await step("Given no similarity candidates", async () => {
      mockDb.supabase.rpc.mockResolvedValue({ data: [], error: null });
    });
    const article = {
      id: "new-2",
      title: "Unique story",
      snippet: "Short",
      published_at: new Date().toISOString(),
      language: "en",
    };
    const clusterId = await step("When I assign a cluster", async () =>
      assignClusterForArticle(article, { sourceId: "src1" })
    );
    await step("Then a new cluster is created with article id", async () => {
      expect(clusterId).toBe(article.id);
    });
  });
});
