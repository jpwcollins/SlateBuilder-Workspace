import { describe, expect, it } from "vitest";
import { planDropWithCascade, CascadeSlate } from "./slateCascade";
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

function slate(dateISO: string, cases: ScoredCase[], locked = false): CascadeSlate {
  return { dateISO, blockMinutes: BLOCK, locked, cases };
}

const ids = (cases: ScoredCase[]) => cases.map((x) => x.caseId).sort();

// Urgent and overdue ranks high; 26-week and well inside target ranks low.
const HIGH = (id: string, min: number) => c(id, 2, -20, min);
const MID = (id: string, min: number) => c(id, 12, 0, min);
const LOW = (id: string, min: number) => c(id, 26, 100, min);

describe("planDropWithCascade", () => {
  it("places the case with no moves when there is room", () => {
    const plan = planDropWithCascade({
      slates: [slate("2027-01-04", [MID("A", 120)])],
      dropped: HIGH("X", 60),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.moves).toEqual([]);
    expect(ids(plan.slates[0])).toEqual(["A", "X"]);
  });

  it("moves the lowest-priority case on a full slate to the next slate", () => {
    // 3 x 120 + 2 turnarounds = 420; another 60 would need 510.
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 120), MID("B", 120), LOW("C", 120)]),
        slate("2027-01-11", []),
      ],
      dropped: HIGH("X", 60),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(ids(plan.slates[0])).toEqual(["A", "B", "X"]);
    expect(ids(plan.slates[1])).toEqual(["C"]);
    expect(plan.moves).toEqual([
      { caseId: "C", displayLabel: "Patient C", fromDateISO: "2027-01-04", toDateISO: "2027-01-11" },
    ]);
  });

  it("takes the dropped case off the slate it came from", () => {
    const x = HIGH("X", 60);
    const plan = planDropWithCascade({
      slates: [slate("2027-01-04", [MID("A", 120)]), slate("2027-01-11", [x])],
      dropped: x,
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok && plan.slates[1]).toEqual([]);
  });

  it("puts back a case taken out if a later removal freed enough room", () => {
    // Taking out LOW C (60) is not enough for X (200); MID B (240) goes too,
    // after which C fits again and stays.
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 60), MID("B", 240), LOW("C", 60)]),
        slate("2027-01-11", []),
      ],
      dropped: HIGH("X", 200),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(ids(plan.slates[0])).toEqual(["A", "C", "X"]);
    expect(plan.moves.map((m) => m.caseId)).toEqual(["B"]);
  });

  it("lets a moved case take free room on an earlier slate", () => {
    // X is dragged from Jan 4 onto the full Jan 11 slate. B, pushed out, takes
    // the room X left on Jan 4 rather than going back to the waitlist.
    const x = HIGH("X", 210);
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 210), x]),
        slate("2027-01-11", [HIGH("D", 210), LOW("B", 210)]),
      ],
      dropped: x,
      targetIndex: 1,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(ids(plan.slates[0])).toEqual(["A", "B"]);
    expect(ids(plan.slates[1])).toEqual(["D", "X"]);
    expect(plan.moves).toEqual([
      { caseId: "B", displayLabel: "Patient B", fromDateISO: "2027-01-11", toDateISO: "2027-01-04" },
    ]);
  });

  it("prefers the earliest slate with free room", () => {
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 60)]),
        slate("2027-01-11", [HIGH("D", 210), LOW("B", 210)]),
        slate("2027-01-18", []),
      ],
      dropped: HIGH("X", 210),
      targetIndex: 1,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok && plan.moves[0].toDateISO).toBe("2027-01-04");
  });

  it("never pushes anyone out of an earlier slate", () => {
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [LOW("L1", 210), LOW("L2", 210)]),
        slate("2027-01-11", [HIGH("D", 210), MID("B", 210)]),
      ],
      dropped: HIGH("X", 210),
      targetIndex: 1,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(ids(plan.slates[0])).toEqual(["L1", "L2"]);
    expect(plan.moves).toEqual([
      { caseId: "B", displayLabel: "Patient B", fromDateISO: "2027-01-11", toDateISO: null },
    ]);
  });

  it("cascades: a moved case can push a lower-ranked one further down", () => {
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 210), MID("B", 210)]),
        slate("2027-01-11", [HIGH("D", 210), LOW("E", 210)]),
        slate("2027-01-18", []),
      ],
      dropped: HIGH("X", 210),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(ids(plan.slates[0])).toEqual(["A", "X"]);
    expect(ids(plan.slates[1])).toEqual(["B", "D"]);
    expect(ids(plan.slates[2])).toEqual(["E"]);
    expect(plan.moves).toEqual([
      { caseId: "B", displayLabel: "Patient B", fromDateISO: "2027-01-04", toDateISO: "2027-01-11" },
      { caseId: "E", displayLabel: "Patient E", fromDateISO: "2027-01-11", toDateISO: "2027-01-18" },
    ]);
  });

  it("never pushes out a higher-ranked case; the moved one goes on or back to the waitlist", () => {
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 210), LOW("B", 210)]),
        slate("2027-01-11", [HIGH("D", 210), HIGH("E", 210)]),
      ],
      dropped: HIGH("X", 210),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(ids(plan.slates[1])).toEqual(["D", "E"]);
    expect(plan.moves).toEqual([
      { caseId: "B", displayLabel: "Patient B", fromDateISO: "2027-01-04", toDateISO: null },
    ]);
  });

  it("skips locked slates and dates the patient is unavailable for", () => {
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 210), c("B", 26, 100, 210, "2027-01-15")]),
        slate("2027-01-11", [], true),
        slate("2027-01-14", []),
        slate("2027-01-18", []),
      ],
      dropped: HIGH("X", 210),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.moves).toEqual([
      { caseId: "B", displayLabel: "Patient B", fromDateISO: "2027-01-04", toDateISO: "2027-01-18" },
    ]);
  });

  it("does not move cases placed by hand", () => {
    const plan = planDropWithCascade({
      slates: [
        slate("2027-01-04", [HIGH("A", 210), LOW("B", 210)]),
        slate("2027-01-11", []),
      ],
      dropped: HIGH("X", 210),
      targetIndex: 0,
      pinned: { A: true, B: true },
      priorityMode: "urgency_then_ttt",
    });
    expect(plan).toEqual({ ok: false, reason: "pinned" });
  });

  it("reports a case that is too long for the day whatever moves", () => {
    const plan = planDropWithCascade({
      slates: [slate("2027-01-04", [LOW("A", 60)])],
      dropped: HIGH("X", 500),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts the seven-case limit as full too", () => {
    const seven = Array.from({ length: 7 }, (_, i) => (i === 6 ? LOW(`S${i}`, 30) : HIGH(`S${i}`, 30)));
    const plan = planDropWithCascade({
      slates: [slate("2027-01-04", seven), slate("2027-01-11", [])],
      dropped: HIGH("X", 30),
      targetIndex: 0,
      pinned: {},
      priorityMode: "urgency_then_ttt",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.slates[0]).toHaveLength(7);
    expect(plan.moves.map((m) => m.caseId)).toEqual(["S6"]);
  });
});
