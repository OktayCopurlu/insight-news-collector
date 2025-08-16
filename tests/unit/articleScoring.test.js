import {
  calculateRecencyScore,
  calculateTitleScore,
} from "../../src/services/articleProcessor.js";
import { step } from "../testStep.js";

describe("articleProcessor scoring functions", () => {
  test("calculateRecencyScore declines over time", async () => {
    let now, oneHourAgo, tenHoursAgo, twoDaysAgo, fourDaysAgo;
    await step("Given timestamps from now to 4 days ago", async () => {
      now = new Date();
      oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);
      twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      fourDaysAgo = new Date(now.getTime() - 96 * 60 * 60 * 1000);
    });

    let sNow, s1h, s10h, s2d, s4d;
    await step("When I calculate recency scores", async () => {
      sNow = calculateRecencyScore(now);
      s1h = calculateRecencyScore(oneHourAgo);
      s10h = calculateRecencyScore(tenHoursAgo);
      s2d = calculateRecencyScore(twoDaysAgo);
      s4d = calculateRecencyScore(fourDaysAgo);
    });

    await step("Then scores monotonically decrease over time", async () => {
      expect(sNow).toBeGreaterThanOrEqual(s1h);
      expect(s1h).toBeGreaterThan(s10h);
      expect(s10h).toBeGreaterThan(s2d);
      expect(s2d).toBeGreaterThan(s4d);
    });
  });

  test("calculateTitleScore favors mid-length titles", async () => {
    await step("Then score ranges reflect length/preferences", async () => {
      expect(calculateTitleScore(""));
      expect(calculateTitleScore("")).toBe(0.0);
      expect(calculateTitleScore("short title")).toBe(0.3);
      expect(
        calculateTitleScore("This is a reasonably sized title for testing")
      ).toBe(1.0);
      expect(
        calculateTitleScore(
          "This is a somewhat longer title that still should score decently but not perfectly"
        )
      ).toBeLessThan(1.0);
    });
  });
});
