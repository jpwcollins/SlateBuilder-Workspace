import { describe, expect, it } from "vitest";
import {
  getBlockMinutes,
  isAvailableOnDate,
  isUnavailableBeyondLimit,
  daysBetween,
  timeToTargetOn,
  timeToTargetPhrase,
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

describe("time to target on the OR date", () => {
  it("counts the days from the list date", () => {
    expect(daysBetween("2026-11-27", "2027-01-01")).toBe(35);
    expect(daysBetween("2027-03-01", "2027-03-31")).toBe(30); // across a DST change
    expect(daysBetween("2027-01-01", "2026-11-27")).toBe(-35);
  });
  it("takes a day off for every day after the list date", () => {
    expect(timeToTargetOn(7, "2026-11-27", "2027-01-01")).toBe(-28);
    expect(timeToTargetOn(-21, "2026-11-27", "2026-12-18")).toBe(-42);
    expect(timeToTargetOn(7, "", "2027-01-01")).toBe(7);
  });
  it("words it", () => {
    expect(timeToTargetPhrase(-28)).toBe("28 days overdue");
    expect(timeToTargetPhrase(-1)).toBe("1 day overdue");
    expect(timeToTargetPhrase(0)).toBe("due that day");
    expect(timeToTargetPhrase(5)).toBe("5 days to target");
  });
});
