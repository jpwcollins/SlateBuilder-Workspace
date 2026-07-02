import { describe, expect, it } from "vitest";
import {
  applyDefaultDuration,
  buildCaseSchedule,
  caseFitsInSlate,
  sortForSlate,
  sortForWaitlist,
  urgencyChipClasses,
} from "./caseHelpers";
import { MAX_CASES_PER_SLATE, scoreCases } from "./optimizer";
import { PatientCase } from "./types";

function makeCase(id: number, overrides: Partial<PatientCase> = {}): PatientCase {
  return {
    caseId: `C-${String(id).padStart(3, "0")}`,
    sourceKey: `${id}`,
    displayLabel: `Patient ${id}`,
    benchmarkWeeks: 2,
    timeToTargetDays: 0,
    estimatedDurationMin: 60,
    surgeonId: "DR1",
    flags: {},
    ...overrides,
  };
}

describe("applyDefaultDuration", () => {
  const durations = { hysteroscopy: 30, laparoscopy: 60, hysterectomy: 180, other: 90 };

  it("matches a duration bucket from the procedure name", () => {
    const result = applyDefaultDuration(makeCase(1, { procedureName: "Total Hysterectomy" }), durations);
    expect(result.estimatedDurationMin).toBe(180);
  });

  it("falls back to 'other' for an unrecognized procedure", () => {
    const result = applyDefaultDuration(makeCase(1, { procedureName: "Something else" }), durations);
    expect(result.estimatedDurationMin).toBe(90);
  });
});

describe("sortForWaitlist", () => {
  it("sorts purely by time-to-target in ttt mode", () => {
    const items = [makeCase(1, { timeToTargetDays: 5 }), makeCase(2, { timeToTargetDays: -3 })];
    const sorted = sortForWaitlist(items, "ttt");
    expect(sorted.map((c) => c.caseId)).toEqual(["C-002", "C-001"]);
  });

  it("sorts by composite priority in urgency_then_ttt mode", () => {
    const items = [
      makeCase(1, { benchmarkWeeks: 26, timeToTargetDays: -1 }),
      makeCase(2, { benchmarkWeeks: 2, timeToTargetDays: -1 }),
    ];
    const sorted = sortForWaitlist(items, "urgency_then_ttt");
    // 2w urgency weight (5) far outranks 26w (1) at the same overdue amount.
    expect(sorted[0].caseId).toBe("C-002");
  });
});

describe("sortForSlate", () => {
  it("places diabetes and OSA flagged cases first, in that order", () => {
    const scored = scoreCases([
      makeCase(1, { timeToTargetDays: -1 }),
      makeCase(2, { timeToTargetDays: -1, flags: { osa: true } }),
      makeCase(3, { timeToTargetDays: -1, flags: { diabetes: true } }),
    ]);
    const sorted = sortForSlate(scored, "urgency_then_ttt");
    expect(sorted.map((c) => c.caseId)).toEqual(["C-003", "C-002", "C-001"]);
  });
});

describe("buildCaseSchedule", () => {
  it("lays out cases back to back with a turnaround gap after every case but the last", () => {
    const scored = scoreCases([
      makeCase(1, { estimatedDurationMin: 60 }),
      makeCase(2, { estimatedDurationMin: 30 }),
    ]);
    const schedule = buildCaseSchedule(scored, "2026-01-08");
    expect(schedule[0].tatAfter).toBe(true);
    expect(schedule[1].tatAfter).toBe(false);
    expect(schedule[1].start).toBe(schedule[0].tatEnd);
  });
});

describe("caseFitsInSlate", () => {
  it("fits when there is enough room including turnaround", () => {
    expect(caseFitsInSlate(120, 2, 60, 480)).toBe(true);
  });

  it("rejects when the block minutes would be exceeded", () => {
    expect(caseFitsInSlate(450, 3, 60, 480)).toBe(false);
  });

  it("rejects once the slate is already at the case cap", () => {
    expect(caseFitsInSlate(0, MAX_CASES_PER_SLATE, 10, 10000)).toBe(false);
  });
});

describe("urgencyChipClasses", () => {
  it("returns a distinct class per benchmark band", () => {
    const classes = new Set([2, 4, 6, 12, 26].map((w) => urgencyChipClasses(w)));
    expect(classes.size).toBe(5);
  });
});
