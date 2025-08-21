export function makeDb(overrides = {}) {
  const updates = [];
  const upserts = [];
  return {
    updates,
    upserts,
    ...{
      articles: {
        update: () => ({
          select: async () => ({ data: [{}], error: null }),
        }),
      },
      translations: {
        upsert: async (row) => {
          upserts.push(row);
          return { data: row, error: null };
        },
      },
    },
    ...overrides,
  };
}

export const SAMPLE_URL = "https://example.com/news/x";
