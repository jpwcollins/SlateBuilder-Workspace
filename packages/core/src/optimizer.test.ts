import { describe, expect, it } from "vitest";
import {
  optimizeSlate,
  optimizeSlatesForDates,
  scoreCases,
  reorderSlateByCaseIds,
  priorityScoreOf,
  TURNAROUND_MINUTES,
  MAX_CASES_PER_SLATE,
} from "./optimizer";
import { getBlockMinutes } from "./date";
import { PatientCase, BenchmarkWeeks } from "./types";

// A non-Thursday so the block is the standard 480 minutes.
const DATE = new Date(2026, 0, 5); // Mon 5 Jan 2026

function makeCase(
  id: number,
  benchmarkWeeks: BenchmarkWeeks,
  timeToTargetDays: number,
  estimatedDurationMin: number
): PatientCase {
  return {
    caseId: `C-${String(id).padStart(3, "0")}`,
    sourceKey: `Patient ${id}`,
    displayLabel: `Patient ${id}`,
    benchmarkWeeks,
    timeToTargetDays,
    estimatedDurationMin,
    surgeonId: "DR1",
    flags: {},
  };
}

const fixture: PatientCase[] = [
  makeCase(1, 2, -10, 120),
  makeCase(2, 4, 3, 200),
  makeCase(3, 6, -2, 90),
  makeCase(4, 12, 20, 300),
  makeCase(5, 2, -30, 150),
  makeCase(6, 26, 40, 60),
  makeCase(7, 4, -5, 240),
  makeCase(8, 6, 1, 180),
];

// Occupied time = surgical minutes + 30-min turnaround after every case but the last.
function occupied(durations: number[]): number {
  const surgical = durations.reduce((a, b) => a + b, 0);
  return surgical + TURNAROUND_MINUTES * Math.max(0, durations.length - 1);
}

describe("optimizeSlate", () => {
  it("keeps occupied time (cases + turnaround) within the block", () => {
    const block = getBlockMinutes(DATE);
    const result = optimizeSlate(fixture, DATE);
    const durations = result.selected.map((item) => Math.round(item.estimatedDurationMin));
    expect(occupied(durations)).toBeLessThanOrEqual(block);
    expect(result.blockMinutes).toBe(block);
    expect(result.turnaroundMinutes).toBe(
      TURNAROUND_MINUTES * Math.max(0, result.selected.length - 1)
    );
  });

  it("never exceeds the 7-case ceiling", () => {
    // Many tiny cases would otherwise all fit on minutes alone.
    const many = Array.from({ length: 20 }, (_, i) => makeCase(i + 1, 2, -i, 20));
    const result = optimizeSlate(many, DATE);
    expect(result.selected.length).toBeLessThanOrEqual(MAX_CASES_PER_SLATE);
  });

  it("never bumps the most urgent over-target case for shorter less-urgent ones", () => {
    // Regression for the original failure: a 2w-overdue 330-min case used to be
    // dropped in favour of four shorter 4w cases. Strategy B must keep it.
    const cases = [
      makeCase(1, 2, -1, 330), // most urgent, long
      makeCase(2, 4, -1, 90),
      makeCase(3, 4, -1, 90),
      makeCase(4, 4, -1, 90),
      makeCase(5, 4, -1, 90),
      makeCase(6, 4, -1, 90),
    ];
    const result = optimizeSlate(cases, DATE);
    expect(result.selected.some((c) => c.caseId === "C-001")).toBe(true);
    expect(result.anchoredCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps an over-target low-urgency case a pure-priority pick would drop", () => {
    // C-001 is overdue but low urgency (26w); the five 2w cases are higher
    // priority and would fill the block on their own. Anchoring must still slate
    // the long-waiter.
    const cases = [
      makeCase(1, 26, -3, 90), // over target, low urgency -> anchored
      makeCase(2, 2, 5, 90),
      makeCase(3, 2, 5, 90),
      makeCase(4, 2, 5, 90),
      makeCase(5, 2, 5, 90),
      makeCase(6, 2, 5, 90),
    ];
    const result = optimizeSlate(cases, DATE);
    expect(result.selected.some((c) => c.caseId === "C-001")).toBe(true);
    expect(result.anchoredCount).toBe(1);
  });

  it("includes everything when all cases fit (with turnaround)", () => {
    const small = [makeCase(1, 2, -1, 60), makeCase(2, 4, -1, 60)];
    const result = optimizeSlate(small, DATE);
    expect(result.selected).toHaveLength(2);
    expect(result.turnaroundMinutes).toBe(TURNAROUND_MINUTES);
  });
});

describe("priorityScoreOf", () => {
  it("rises with waiting before target (FIFO)", () => {
    const longWait = priorityScoreOf({ benchmarkWeeks: 6, timeToTargetDays: 2 });
    const shortWait = priorityScoreOf({ benchmarkWeeks: 6, timeToTargetDays: 41 });
    expect(longWait).toBeGreaterThan(shortWait);
  });

  it("ranks a breached short-target case above a long-overdue long-target case", () => {
    const shortBreached = priorityScoreOf({ benchmarkWeeks: 2, timeToTargetDays: -14 });
    const longOverdue = priorityScoreOf({ benchmarkWeeks: 26, timeToTargetDays: -140 });
    expect(shortBreached).toBeGreaterThan(longOverdue);
  });
});

describe("reorderSlateByCaseIds", () => {
  it("applies a saved order and appends unknown cases", () => {
    const scored = scoreCases(fixture.slice(0, 3));
    const reordered = reorderSlateByCaseIds(scored, ["C-003", "C-001"]);
    expect(reordered.map((c) => c.caseId)).toEqual(["C-003", "C-001", "C-002"]);
  });

  it("returns input unchanged when no order is given", () => {
    const scored = scoreCases(fixture.slice(0, 2));
    expect(reorderSlateByCaseIds(scored, undefined)).toBe(scored);
  });
});

describe("hand placements", () => {
  const MON = new Date(2026, 0, 5);
  const TUE = new Date(2026, 0, 6);
  // Two overdue 210-minute cases fill a day (210 + 30 + 210 = 450).
  const urgent = [makeCase(1, 2, -30, 210), makeCase(2, 2, -20, 210)];
  const low = makeCase(3, 26, 100, 210);

  it("puts a hand-placed case on its date ahead of higher-ranked ones", () => {
    const results = optimizeSlatesForDates([...urgent, low], [MON, TUE], { "C-003": "2026-01-05" });
    expect(results[0].selected.map((c) => c.caseId).sort()).toEqual(["C-001", "C-003"]);
    expect(results[1].selected.map((c) => c.caseId)).toEqual(["C-002"]);
  });

  it("keeps a hand-placed case off the other dates", () => {
    const results = optimizeSlatesForDates([...urgent, low], [MON, TUE], { "C-001": "2026-01-06" });
    expect(results[0].selected.map((c) => c.caseId)).not.toContain("C-001");
    expect(results[1].selected.map((c) => c.caseId)).toContain("C-001");
  });

  it("ignores a placement on a date not planned or the patient can't make", () => {
    const away = { ...low, unavailableUntil: "2026-01-10" };
    const results = optimizeSlatesForDates([...urgent, away], [MON, TUE], {
      "C-003": "2026-01-06",
      "C-001": "2026-02-01",
    });
    const all = results.flatMap((r) => r.selected.map((c) => c.caseId));
    expect(all).not.toContain("C-003");
    expect(results[0].selected.map((c) => c.caseId)).toContain("C-001");
  });

  it("matches the plain optimizer when nothing is placed by hand", () => {
    const plain = optimizeSlate(fixture, DATE);
    const pinnedNone = optimizeSlate(fixture, DATE, []);
    expect(pinnedNone.selected.map((c) => c.caseId)).toEqual(plain.selected.map((c) => c.caseId));
  });
});
