import request from "supertest";
import app from "../../src/app.js";
import { step } from "../testStep.js";
import { testConnection, supabase } from "../../src/config/database.js";

/**
 * These E2E tests validate that:
 * 1. The express server basic health endpoint works.
 * 2. The Supabase connection can be established (using testConnection()).
 * 3. A simple query against a core table (sources) succeeds when env is present.
 * 4. The live DB health endpoint reports status (when env present).
 *
 * If Supabase env vars are not present locally, DB-related tests are skipped rather than failing
 * to allow contributors to run the test suite without full credentials. In CI, absence will fail fast
 * via jest.setup.js.
 */

const hasSupabaseEnv = !!(
  process.env.SUPABASE_URL &&
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
);

describe("E2E: Health & Database connectivity", () => {
  test("GET /health returns healthy status", async () => {
    const res = await step("When I request /health", async () =>
      request(app).get("/health").expect(200)
    );
    await step("Then it reports healthy status and database field", async () => {
      expect(res.body).toMatchObject({ success: true, status: "healthy" });
      expect(res.body.database).toBeDefined();
    });
  });

  (hasSupabaseEnv ? test : test.skip)("Supabase testConnection() returns true", async () => {
    const ok = await step("When I call testConnection()", async () =>
      testConnection()
    );
    await step("Then it returns true", async () => {
      expect(ok).toBe(true);
    });
  });

  (hasSupabaseEnv ? test : test.skip)("Supabase can select from sources table (or it is empty)", async () => {
    // Query minimal data to verify connectivity & authorization; tolerate empty table
    const { data, error } = await step(
      "When I select from sources with limit 1",
      async () => supabase.from("sources").select("id").limit(1)
    );
    await step("Then there is no error and data is an array", async () => {
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  (hasSupabaseEnv ? test : test.skip)("GET /health/db returns connected status", async () => {
    const res = await step("When I request /health/db", async () =>
      request(app).get("/health/db").expect(200)
    );
    await step("Then it reports connected and includes latencyMs", async () => {
      expect(res.body).toMatchObject({ success: true, database: "connected" });
      expect(typeof res.body.latencyMs).toBe("number");
    });
  });
});
