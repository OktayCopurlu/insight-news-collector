import {
  calculateRecencyScore,
  calculateTitleScore,
} from "../../src/services/articleProcessor.js";

describe("articleProcessor scoring functions", () => {
  test("calculateRecencyScore declines over time", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const tenHoursAgo = new Date(now.getTime() - 10 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const fourDaysAgo = new Date(now.getTime() - 96 * 60 * 60 * 1000);

    const sNow = calculateRecencyScore(now);
    const s1h = calculateRecencyScore(oneHourAgo);
    const s10h = calculateRecencyScore(tenHoursAgo);
    const s2d = calculateRecencyScore(twoDaysAgo);
    const s4d = calculateRecencyScore(fourDaysAgo);

    expect(sNow).toBeGreaterThanOrEqual(s1h);
    expect(s1h).toBeGreaterThan(s10h);
    expect(s10h).toBeGreaterThan(s2d);
    expect(s2d).toBeGreaterThan(s4d);
  });

  test("calculateTitleScore favors mid-length titles", () => {
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
