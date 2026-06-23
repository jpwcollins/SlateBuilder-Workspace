import { describe, expect, it } from "vitest";
import { getBlockMinutes, isAvailableOnDate, toLocalDateOnly } from "./date";

describe("getBlockMinutes", () => {
  it("uses 420 minutes on the 2nd Thursday of the month", () => {
    // Jan 2026: Thursdays fall on 1, 8, 15, 22, 29. The 8th is the 2nd Thursday.
    expect(getBlockMinutes(new Date(2026, 0, 8))).toBe(420);
  });

  it("uses 480 minutes on the 1st Thursday and other weekdays", () => {
    expect(getBlockMinutes(new Date(2026, 0, 1))).toBe(480); // 1st Thursday
    expect(getBlockMinutes(new Date(2026, 0, 5))).toBe(480); // Monday
  });
});

describe("isAvailableOnDate", () => {
  it("compares on the local calendar date (no UTC off-by-one)", () => {
    const date = new Date(2026, 0, 9); // local 9 Jan 2026
    expect(toLocalDateOnly(date)).toBe("2026-01-09");
    expect(isAvailableOnDate("2026-01-10", date)).toBe(false);
    expect(isAvailableOnDate("2026-01-09", date)).toBe(true);
    expect(isAvailableOnDate("2026-01-08", date)).toBe(true);
  });

  it("treats a missing unavailable date as available", () => {
    expect(isAvailableOnDate(undefined, new Date(2026, 0, 9))).toBe(true);
    expect(isAvailableOnDate("", new Date(2026, 0, 9))).toBe(true);
  });
});
