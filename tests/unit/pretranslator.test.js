import { jest } from "@jest/globals";
import { step } from "../testStep.js";
import crypto from "node:crypto";

// Build an in-memory mock for supabase and DB helpers
function createDbState() {
  const now = new Date().toISOString();
  const pivotSig = sha1_10(`Pivot Title\nPivot Summary\nPivot Details`);
  return {
    app_markets: [
      {
        id: 1,
        market_code: "CH",
        enabled: true,
        pivot_lang: "en",
        pretranslate_langs: "tr,de",
      },
    ],
    clusters: [{ id: 101, updated_at: now }],
    cluster_ai: [
      {
        id: 5001,
        cluster_id: 101,
        lang: "en",
        ai_title: "Pivot Title",
        ai_summary: "Pivot Summary",
        ai_details: "Pivot Details",
        is_current: true,
        created_at: now,
        pivot_hash: pivotSig,
        model: `pivot-model#ph=${pivotSig}`,
      },
    ],
  };
}

function sha1_10(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
}

async function setupMocks(state) {
  // Mock translation helper to be deterministic and fast
  await jest.unstable_mockModule(
    "../../src/services/translationHelper.js",
    () => ({
      translateText: async (text, { srcLang, dstLang }) =>
        `[${srcLang}->${dstLang}] ${text}`,
      translateFields: async (
        { title = "", summary = "", details = "" },
        { srcLang, dstLang }
      ) => ({
        title: `[${srcLang}->${dstLang}] ${title}`,
        summary: `[${srcLang}->${dstLang}] ${summary}`,
        details: `[${srcLang}->${dstLang}] ${details}`,
      }),
      clearTranslationCache: () => {},
    })
  );

  // Supabase-like chainable mock
  const supabase = {
    from(table) {
      const q = {
        _table: table,
        _select: null,
        _filters: [],
        _gte: null,
        _order: null,
        _limit: null,
        select(cols) {
          this._select = cols;
          return this;
        },
        gte(col, val) {
          this._gte = { col, val };
          return this;
        },
        order(col, { ascending }) {
          this._order = { col, ascending };
          return this;
        },
        limit(n) {
          this._limit = n;
          return this._exec();
        },
        eq(col, val) {
          this._filters.push({ col, val });
          return this; // allow chaining; awaiting the builder triggers then()/_exec
        },
        async _exec() {
          // app_markets
          if (table === "app_markets") {
            return { data: [...state.app_markets], error: null };
          }
          // clusters
          if (table === "clusters") {
            let rows = [...state.clusters];
            if (this._gte && this._gte.col === "updated_at") {
              rows = rows.filter((r) => r.updated_at >= this._gte.val);
            }
            if (this._limit != null) rows = rows.slice(0, this._limit);
            return { data: rows, error: null };
          }
          // cluster_ai
          if (table === "cluster_ai") {
            let rows = [...state.cluster_ai];
            for (const f of this._filters) {
              rows = rows.filter((r) => String(r[f.col]) === String(f.val));
            }
            return { data: rows, error: null };
          }
          return { data: [], error: null };
        },
        // Make await on this chainable object resolve to _exec() result
        then(resolve, reject) {
          this._exec().then(resolve, reject);
        },
      };
      return q;
    },
  };

  // DB helpers that pretranslator uses for writes
  await jest.unstable_mockModule("../../src/config/database.js", () => ({
    supabase,
    selectRecords: async () => [],
    insertRecord: async (table, row) => {
      if (table === "cluster_ai") {
        const id =
          (state.cluster_ai[state.cluster_ai.length - 1]?.id || 6000) + 1;
        state.cluster_ai.push({
          id,
          ...row,
          created_at: new Date().toISOString(),
        });
        return { id };
      }
      return {};
    },
    updateRecord: async (table, id, patch) => {
      if (table === "cluster_ai") {
        const idx = state.cluster_ai.findIndex((r) => r.id === id);
        if (idx >= 0)
          state.cluster_ai[idx] = { ...state.cluster_ai[idx], ...patch };
      }
      return {};
    },
  }));
}

describe("pretranslator job queue", () => {
  test("enqueues and processes jobs for missing targets", async () => {
    const state = await step(
      "Given DB state with one pivot cluster",
      async () => createDbState()
    );
    await step("And mocks are installed", async () => setupMocks(state));
    const { runPretranslationCycle } = await import(
      "../../src/services/pretranslator.js"
    );

    const res1 = await step("When I run a pretranslation cycle", async () =>
      runPretranslationCycle({
        recentHours: 48,
        concurrency: 2,
        perItemTimeoutMs: 500,
      })
    );
    await step("Then two jobs and inserts are created for tr,de", async () => {
      expect(res1.jobsCreated).toBe(2);
      expect(res1.translationsInserted).toBe(2);
    });

    await step("And pivot signature is present on inserted rows", async () => {
      const pivotSig = sha1_10(`Pivot Title\nPivot Summary\nPivot Details`);
      const tr = state.cluster_ai.find(
        (r) => r.lang === "tr" && r.cluster_id === 101
      );
      const de = state.cluster_ai.find(
        (r) => r.lang === "de" && r.cluster_id === 101
      );
      expect(tr).toBeTruthy();
      expect(de).toBeTruthy();
      expect(
        tr.pivot_hash === pivotSig ||
          (tr.model || "").includes(`#ph=${pivotSig}`)
      ).toBe(true);
      expect(
        de.pivot_hash === pivotSig ||
          (de.model || "").includes(`#ph=${pivotSig}`)
      ).toBe(true);
    });

    const res2 = await step(
      "When I run the cycle again, no new work is created",
      async () =>
        runPretranslationCycle({
          recentHours: 48,
          concurrency: 2,
          perItemTimeoutMs: 500,
        })
    );
    await step(
      "Then jobsCreated and translationsInserted are zero",
      async () => {
        expect(res2.jobsCreated).toBe(0);
        expect(res2.translationsInserted).toBe(0);
      }
    );
  });

  test("skips already fresh lang by pivot hash", async () => {
    const state = createDbState();
    // Pre-seed a fresh 'tr' row using the same pivot signature
    const pivotSig = sha1_10(`Pivot Title\nPivot Summary\nPivot Details`);
    state.cluster_ai.push({
      id: 5002,
      cluster_id: 101,
      lang: "tr",
      ai_title: "x",
      ai_summary: "y",
      ai_details: "z",
      is_current: true,
      created_at: new Date().toISOString(),
      pivot_hash: pivotSig,
      model: `pretranslator#ph=${pivotSig}`,
    });

    await step("Given mocks installed and modules reset", async () => {
      await setupMocks(state);
      // fresh import so that internal idempotency maps are clean for this test
      jest.resetModules();
      await setupMocks(state);
    });
    const { runPretranslationCycle } = await import(
      "../../src/services/pretranslator.js"
    );

    const res = await step("When I run the pretranslation cycle", async () =>
      runPretranslationCycle({
        recentHours: 48,
        concurrency: 2,
        perItemTimeoutMs: 500,
      })
    );
    await step(
      "Then only 'de' is processed because 'tr' is fresh by pivot",
      async () => {
        expect(res.jobsCreated).toBe(1);
        expect(res.translationsInserted).toBe(1);
        const de = state.cluster_ai.filter(
          (r) => r.cluster_id === 101 && r.lang === "de"
        );
        expect(de.length).toBe(1);
      }
    );
  });
});
