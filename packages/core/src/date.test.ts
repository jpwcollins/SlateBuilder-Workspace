import { describe, expect, it } from "vitest";
import {
  getBlockMinutes,
  isAvailableOnDate,
  isUnavailableBeyondLimit,
  toLocalDateOnly,
  unavailableLimitISO,
} from "./date";

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

describe("unavailable-until limit", () => {
  const today = new Date(2026, 10, 27); // 27 Nov 2026
  it("is a year from today", () => {
    expect(unavailableLimitISO(today)).toBe("2027-11-27");
  });
  it("flags only dates after the limit", () => {
    expect(isUnavailableBeyondLimit("2027-11-27", today)).toBe(false);
    expect(isUnavailableBeyondLimit("2027-11-28", today)).toBe(true);
    expect(isUnavailableBeyondLimit(undefined, today)).toBe(false);
    expect(isUnavailableBeyondLimit("2030-01-01T00:00:00", today)).toBe(true);
  });
});
