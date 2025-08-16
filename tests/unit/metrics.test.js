import request from "supertest";
import app from "../../src/app.js";
import { step } from "../testStep.js";

describe("/metrics endpoint", () => {
  it("returns JSON with translation and pretranslation metrics", async () => {
    const res = await step("When I request /metrics", async () =>
      request(app).get("/metrics").expect(200)
    );
    await step("Then the response contains expected metric sections", async () => {
      expect(res.body).toHaveProperty("service", "insight-feeder");
      expect(res.body).toHaveProperty("translation");
      expect(res.body.translation).toHaveProperty("providerCalls");
      expect(res.body.translation).toHaveProperty("cacheHits");
      expect(res.body).toHaveProperty("pretranslation");
      expect(res.body.pretranslation).toHaveProperty("cycles");
    });
  });
});
