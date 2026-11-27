import { describe, expect, it } from "vitest";
import { planOptimizeUtilization, OptimizeSlate, occupiedMinutes } from "./optimizeUtilization";
import { scoreCases } from "./optimizer";
import { BenchmarkWeeks, PatientCase, ScoredCase } from "./types";

// Standard 480-minute blocks; 30-minute turnaround after every case but the last.
const BLOCK = 480;

function c(
  id: string,
  benchmarkWeeks: BenchmarkWeeks,
  timeToTargetDays: number,
  estimatedDurationMin: number,
  unavailableUntil?: string,
): ScoredCase {
  const item: PatientCase = {
    caseId: id,
    sourceKey: id,
    displayLabel: `Patient ${id}`,
    benchmarkWeeks,
    timeToTargetDays,
    estimatedDurationMin,
    surgeonId: "DR1",
    unavailableUntil,
    flags: {},
  };
  return scoreCases([item])[0];
}

function slate(dateISO: string, cases: ScoredCase[], locked = false): OptimizeSlate {
  return { dateISO, blockMinutes: BLOCK, locked, cases };
}

const ids = (cases: ScoredCase[]) => cases.map((x) => x.caseId).sort();

const OVERDUE = (id: string, min: number) => c(id, 2, -20, min);
const HIGH = (id: string, min: number) => c(id, 2, 5, min);
const MID = (id: string, min: number) => c(id, 12, 0, min);
const LOW = (id: string, min: number) => c(id, 26, 100, min);

const run = (slates: OptimizeSlate[], waiting: ScoredCase[], pinned: Record<string, boolean> = {}) =>
  planOptimizeUtilization({ slates, waiting, pinned, priorityMode: "urgency_then_ttt" });

describe("planOptimizeUtilization", () => {
  it("leaves full slates alone, even when a longer case is waiting", () => {
    // 210 + 30 + 240 = 480: full. A 26-week 240 waiting must not displace them.
    const result = run(
      [slate("2027-01-04", [HIGH("A", 210), MID("B", 240)])],
      [LOW("L", 240), LOW("M", 450)],
    );
    expect(result.changed).toBe(false);
    expect(ids(result.slates[0])).toEqual(["A", "B"]);
  });

  it("does not swap when the slate would hold no more OR time", () => {
    // 420 used; swapping LOW C (120) for MID X (120) gains nothing.
    const result = run(
      [slate("2027-01-04", [HIGH("A", 120), HIGH("B", 120), LOW("C", 120)])],
      [MID("X", 120)],
    );
    expect(result.changed).toBe(false);
  });

  it("fills free room from the waitlist in priority order", () => {
    const result = run(
      [slate("2027-01-04", [HIGH("A", 210)])],
      [LOW("L", 240), HIGH("H", 240)],
    );
    expect(result.changed).toBe(true);
    expect(ids(result.slates[0])).toEqual(["A", "H"]);
  });

  it("takes the highest-ranked patient who fits the gap", () => {
    // 240 left after A's turnaround: the HIGH 300 does not fit, MID 240 does.
    const result = run(
      [slate("2027-01-04", [HIGH("A", 210)])],
      [HIGH("H", 300), MID("M", 240), LOW("L", 240)],
    );
    expect(ids(result.slates[0])).toEqual(["A", "M"]);
  });

  it("puts a waiting patient on the earliest slate with room", () => {
    const result = run(
      [slate("2027-01-04", [HIGH("A", 300)]), slate("2027-01-11", [])],
      [MID("M", 120)],
    );
    expect(ids(result.slates[0])).toEqual(["A", "M"]);
    expect(result.slates[1]).toEqual([]);
  });

  it("swaps when that adds OR time and the one coming in outranks the one going out", () => {
    // 120 + 30 + 120 = 270 used; X (300) can't fit beside both. Taking off
    // LOW C for HIGH X gives 120 + 30 + 300 = 450.
    const result = run(
      [slate("2027-01-04", [HIGH("A", 120), LOW("C", 120)])],
      [HIGH("X", 300)],
    );
    expect(result.changed).toBe(true);
    expect(ids(result.slates[0])).toEqual(["A", "X"]);
  });

  it("never swaps out a higher-ranked patient for a lower-ranked one", () => {
    const result = run(
      [slate("2027-01-04", [HIGH("A", 120), HIGH("B", 120)])],
      [LOW("L", 420)],
    );
    expect(result.changed).toBe(false);
  });

  it("re-places a swapped-out patient on another slate with room", () => {
    const result = run(
      [
        slate("2027-01-04", [HIGH("A", 120), LOW("C", 120)]),
        slate("2027-01-11", [HIGH("D", 300)], true),
        slate("2027-01-18", [HIGH("E", 300)]),
      ],
      [HIGH("X", 300)],
    );
    expect(ids(result.slates[0])).toEqual(["A", "X"]);
    expect(ids(result.slates[1])).toEqual(["D"]);
    expect(ids(result.slates[2])).toEqual(["C", "E"]);
  });

  it("skips locked slates and dates the patient is unavailable for", () => {
    const result = run(
      [
        slate("2027-01-04", [], true),
        slate("2027-01-11", []),
        slate("2027-01-18", []),
      ],
      [c("U", 12, 0, 120, "2027-01-15")],
    );
    expect(result.slates[0]).toEqual([]);
    expect(result.slates[1]).toEqual([]);
    expect(ids(result.slates[2])).toEqual(["U"]);
  });

  it("does not swap out cases placed by hand", () => {
    const result = run(
      [slate("2027-01-04", [HIGH("A", 120), LOW("C", 120)])],
      [HIGH("X", 300)],
      { C: true },
    );
    expect(result.changed).toBe(false);
  });

  it("never swaps out an overdue patient for one who is not yet overdue", () => {
    // A 26-week overdue case can rank below a 2-week one that isn't overdue,
    // but it still keeps its place.
    const overdueLow = c("O", 26, -5, 120);
    const result = run(
      [slate("2027-01-04", [HIGH("A", 120), overdueLow])],
      [HIGH("X", 300)],
    );
    expect(ids(result.slates[0])).toEqual(["A", "O"]);
  });

  it("lets an overdue patient swap out a lower-ranked overdue one when that adds time", () => {
    const result = run(
      [slate("2027-01-04", [OVERDUE("A", 120), c("O", 26, -5, 120)])],
      [OVERDUE("X", 300)],
    );
    expect(ids(result.slates[0])).toEqual(["A", "X"]);
  });

  it("only ever adds OR time", () => {
    const slates = [
      slate("2027-01-04", [HIGH("A", 60), MID("B", 90), LOW("C", 45)]),
      slate("2027-01-11", [LOW("D", 200), LOW("E", 30)]),
    ];
    const waiting = [HIGH("W1", 240), MID("W2", 150), LOW("W3", 400), OVERDUE("W4", 180)];
    const result = run(slates, waiting);
    result.slates.forEach((cases, i) => {
      expect(occupiedMinutes(cases)).toBeGreaterThanOrEqual(occupiedMinutes(slates[i].cases));
      expect(occupiedMinutes(cases)).toBeLessThanOrEqual(BLOCK);
    });
  });
});
