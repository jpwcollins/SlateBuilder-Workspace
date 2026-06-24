import { describe, expect, it } from "vitest";
import {
  optimizeSlate,
  scoreCases,
  reorderSlateByCaseIds,
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

  it("selects the value-optimal subset under both constraints (matches brute force)", () => {
    const block = getBlockMinutes(DATE);
    const scored = scoreCases(fixture, DATE);
    const durations = scored.map((c) => Math.round(c.estimatedDurationMin));
    const values = scored.map((c) => c.valueScore);

    let best = 0;
    for (let mask = 0; mask < 1 << scored.length; mask += 1) {
      const chosen: number[] = [];
      let value = 0;
      for (let i = 0; i < scored.length; i += 1) {
        if (mask & (1 << i)) {
          chosen.push(durations[i]);
          value += values[i];
        }
      }
      if (chosen.length <= MAX_CASES_PER_SLATE && occupied(chosen) <= block && value > best) {
        best = value;
      }
    }

    const result = optimizeSlate(fixture, DATE);
    const selectedValue = result.selected.reduce((sum, item) => sum + item.valueScore, 0);
    expect(selectedValue).toBeCloseTo(best, 6);
  });

  it("includes everything when all cases fit (with turnaround)", () => {
    const small = [makeCase(1, 2, -1, 60), makeCase(2, 4, -1, 60)];
    const result = optimizeSlate(small, DATE);
    expect(result.selected).toHaveLength(2);
    expect(result.turnaroundMinutes).toBe(TURNAROUND_MINUTES);
  });
});

describe("reorderSlateByCaseIds", () => {
  it("applies a saved order and appends unknown cases", () => {
    const scored = scoreCases(fixture.slice(0, 3), DATE);
    const reordered = reorderSlateByCaseIds(scored, ["C-003", "C-001"]);
    expect(reordered.map((c) => c.caseId)).toEqual(["C-003", "C-001", "C-002"]);
  });

  it("returns input unchanged when no order is given", () => {
    const scored = scoreCases(fixture.slice(0, 2), DATE);
    expect(reorderSlateByCaseIds(scored, undefined)).toBe(scored);
  });
});
