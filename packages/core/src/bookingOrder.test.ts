import { describe, expect, it } from "vitest";
import {
  classifyBookingOrder,
  countBookingOrder,
  findUnexplainedPutOffs,
  parseOrderReason,
  unexplainedPutOffNote,
  ranksAhead,
  ORDER_REASON_NOTE_MAX,
} from "./bookingOrder";
import { BenchmarkWeeks, ClinicalFlags, PatientCase } from "./types";

const DAY1 = "2026-01-05";
const DAY2 = "2026-01-12";

// All in one benchmark class unless stated, so rank is simply "waited longest
// first": a lower time-to-target ranks ahead.
function makeCase(
  id: string,
  timeToTargetDays: number,
  over: { benchmarkWeeks?: BenchmarkWeeks; unavailableUntil?: string; flags?: ClinicalFlags } = {}
): PatientCase {
  return {
    caseId: id,
    sourceKey: id,
    displayLabel: id,
    benchmarkWeeks: over.benchmarkWeeks ?? 6,
    timeToTargetDays,
    estimatedDurationMin: 60,
    surgeonId: "DR1",
    flags: over.flags ?? {},
    unavailableUntil: over.unavailableUntil,
  };
}

describe("ranksAhead", () => {
  it("puts the longer wait first within a benchmark class", () => {
    expect(ranksAhead(makeCase("A", -10), makeCase("B", 5), "urgency_then_ttt")).toBe(true);
    expect(ranksAhead(makeCase("B", 5), makeCase("A", -10), "urgency_then_ttt")).toBe(false);
  });

  it("treats a tie as neither ahead", () => {
    const a = makeCase("A", 5);
    const b = makeCase("B", 5);
    expect(ranksAhead(a, b, "urgency_then_ttt")).toBe(false);
    expect(ranksAhead(b, a, "urgency_then_ttt")).toBe(false);
  });

  it("follows urgency across classes under the composite rule, and wait alone under ttt", () => {
    const urgent = makeCase("U", 7, { benchmarkWeeks: 2 });
    const routine = makeCase("R", 0, { benchmarkWeeks: 26 });
    expect(ranksAhead(urgent, routine, "urgency_then_ttt")).toBe(true);
    expect(ranksAhead(routine, urgent, "ttt")).toBe(true);
  });
});

describe("classifyBookingOrder", () => {
  it("marks a slate that took the top of the list as FIFO", () => {
    const a = makeCase("A", -20);
    const b = makeCase("B", -10);
    const c = makeCase("C", 5);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [a, b] }],
      candidates: [a, b, c],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.A.status).toBe("fifo");
    expect(result.B.status).toBe("fifo");
    expect(result.C).toBeUndefined();
  });

  it("is FIFO when the higher-ranked patient is booked on an earlier slate", () => {
    const a = makeCase("A", -20);
    const b = makeCase("B", -10);
    const result = classifyBookingOrder({
      slates: [
        { dateISO: DAY1, cases: [a] },
        { dateISO: DAY2, cases: [b] },
      ],
      candidates: [a, b],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.A.status).toBe("fifo");
    expect(result.B.status).toBe("fifo");
  });

  it("does not count passing a patient who is unavailable that day", () => {
    const away = makeCase("AWAY", -30, { unavailableUntil: "2026-02-01" });
    const b = makeCase("B", -10);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [b] }],
      candidates: [away, b],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.B.status).toBe("fifo");
  });

  it("counts a patient whose unavailability has ended by the slate date", () => {
    const back = makeCase("BACK", -30, { unavailableUntil: "2026-01-02" });
    const b = makeCase("B", -10);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [b] }],
      candidates: [back, b],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.B.status).toBe("optimization");
  });

  it("calls it optimization when nobody intervened", () => {
    const big = makeCase("BIG", -30);
    const small = makeCase("SMALL", -5);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [small] }],
      candidates: [big, small],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.SMALL.status).toBe("optimization");
    expect(result.SMALL.passedCaseIds).toEqual(["BIG"]);
    expect(result.SMALL.detail).toContain("1 higher-ranked patient ");
  });

  it("calls it optimization when the higher-ranked patient landed on a later slate", () => {
    const big = makeCase("BIG", -30);
    const small = makeCase("SMALL", -5);
    const result = classifyBookingOrder({
      slates: [
        { dateISO: DAY1, cases: [small] },
        { dateISO: DAY2, cases: [big] },
      ],
      candidates: [big, small],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.SMALL.status).toBe("optimization");
    expect(result.BIG.status).toBe("fifo");
  });

  it("flags a manual placement with nothing to account for it", () => {
    const a = makeCase("A", -30);
    const jumper = makeCase("J", 20);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [jumper] }],
      candidates: [a, jumper],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { J: DAY1 },
    });
    expect(result.J.status).toBe("unexplained");
    expect(result.J.needsReasonCaseIds).toEqual(["J"]);
  });

  it("accepts a recorded reason for a manual placement", () => {
    const a = makeCase("A", -30);
    const jumper = makeCase("J", 20);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [jumper] }],
      candidates: [a, jumper],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { J: DAY1 },
      reasons: { J: { code: "clinical_urgency", note: "seen in clinic" } },
    });
    expect(result.J.status).toBe("clinical");
    expect(result.J.reasons).toEqual(["Clinical urgency"]);
    // The typed note is for the office only and must not reach export text.
    expect(result.J.detail).not.toContain("seen in clinic");
  });

  it("infers a clinical exception from a flag on the patient who was moved", () => {
    const a = makeCase("A", -30);
    const jumper = makeCase("J", 20, { flags: { osa: true, diabetes: true } });
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [jumper] }],
      candidates: [a, jumper],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { J: DAY1 },
    });
    expect(result.J.status).toBe("clinical");
    expect(result.J.reasons).toEqual(["Clinical flag: OSA, Diabetes"]);
  });

  it("does not let a flag turn an untouched optimizer choice into a clinical exception", () => {
    const big = makeCase("BIG", -30);
    const small = makeCase("SMALL", -5, { flags: { osa: true } });
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [small] }],
      candidates: [big, small],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.SMALL.status).toBe("optimization");
  });

  it("ignores a manual placement that is in order anyway", () => {
    const a = makeCase("A", -30);
    const b = makeCase("B", 20);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [a] }],
      candidates: [a, b],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { A: DAY1 },
    });
    expect(result.A.status).toBe("fifo");
  });

  it("ignores a manual placement recorded for a different date", () => {
    const big = makeCase("BIG", -30);
    const small = makeCase("SMALL", -5);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [small] }],
      candidates: [big, small],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { SMALL: DAY2 },
    });
    expect(result.SMALL.status).toBe("optimization");
  });

  it("does not mark the cases behind a held-back patient, reason or no reason", () => {
    const held = makeCase("HELD", -30);
    const b = makeCase("B", -5);
    const base = {
      slates: [{ dateISO: DAY1, cases: [b] }],
      candidates: [held, b],
      priorityMode: "urgency_then_ttt" as const,
      heldBack: { HELD: true },
    };
    expect(classifyBookingOrder(base).B.status).toBe("fifo");
    expect(
      classifyBookingOrder({ ...base, reasons: { HELD: { code: "patient_deferred" } } }).B.status
    ).toBe("fifo");
  });

  it("does not mark the cases behind a patient dragged to a later slate", () => {
    const delayed = makeCase("DELAYED", -30);
    const b = makeCase("B", -5);
    const result = classifyBookingOrder({
      slates: [
        { dateISO: DAY1, cases: [b] },
        { dateISO: DAY2, cases: [delayed] },
      ],
      candidates: [delayed, b],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { DELAYED: DAY2 },
    });
    expect(result.B.status).toBe("fifo");
    expect(result.DELAYED.status).toBe("fifo");
  });

  it("still marks a case the app itself placed ahead of a later-slated patient", () => {
    // Nobody put BIG off, so BIG counts, whatever flags BIG carries.
    const big = makeCase("BIG", -30, { flags: { osa: true } });
    const small = makeCase("SMALL", -5);
    const result = classifyBookingOrder({
      slates: [
        { dateISO: DAY1, cases: [small] },
        { dateISO: DAY2, cases: [big] },
      ],
      candidates: [big, small],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.SMALL.status).toBe("optimization");
  });

  it("judges a case only against patients who were not put off", () => {
    const held = makeCase("HELD", -40);
    const big = makeCase("BIG", -30);
    const b = makeCase("B", -5);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [b] }],
      candidates: [held, big, b],
      priorityMode: "urgency_then_ttt",
      heldBack: { HELD: true },
    });
    expect(result.B.status).toBe("optimization");
    expect(result.B.passedCaseIds).toEqual(["BIG"]);
  });

  it("marks only the case that was dragged, and names it as the one needing a reason", () => {
    const a = makeCase("A", -30);
    const c = makeCase("C", -20);
    const neighbour = makeCase("N", -40);
    const jumper = makeCase("J", 20);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [neighbour, jumper] }],
      candidates: [a, c, neighbour, jumper],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { J: DAY1 },
    });
    expect(result.J.status).toBe("unexplained");
    expect(result.J.needsReasonCaseIds).toEqual(["J"]);
    expect(result.J.passedCaseIds).toEqual(["A", "C"]);
    expect(result.N.status).toBe("fifo");
  });

  it("lets a manual placement's reason cover everyone that case passed", () => {
    const a = makeCase("A", -30);
    const c = makeCase("C", -20);
    const jumper = makeCase("J", 20);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [jumper] }],
      candidates: [a, c, jumper],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { J: DAY1 },
      reasons: { J: { code: "clinical_urgency" } },
    });
    expect(result.J.status).toBe("clinical");
    expect(result.J.reasons).toEqual(["Clinical urgency"]);
  });

  it("judges order by the active priority rule", () => {
    const urgent = makeCase("U", 7, { benchmarkWeeks: 2 });
    const routine = makeCase("R", 0, { benchmarkWeeks: 26 });
    const slates = [{ dateISO: DAY1, cases: [routine] }];
    const candidates = [urgent, routine];
    expect(
      classifyBookingOrder({ slates, candidates, priorityMode: "urgency_then_ttt" }).R.status
    ).toBe("optimization");
    expect(classifyBookingOrder({ slates, candidates, priorityMode: "ttt" }).R.status).toBe("fifo");
  });

  it("does not count patients who tie", () => {
    const a = makeCase("A", -5);
    const b = makeCase("B", -5);
    const result = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [b] }],
      candidates: [a, b],
      priorityMode: "urgency_then_ttt",
    });
    expect(result.B.status).toBe("fifo");
  });

  it("counts statuses for a slate summary", () => {
    const big = makeCase("BIG", -30);
    const a = makeCase("A", -40);
    const small = makeCase("SMALL", -5);
    const order = classifyBookingOrder({
      slates: [{ dateISO: DAY1, cases: [a, small] }],
      candidates: [a, big, small],
      priorityMode: "urgency_then_ttt",
    });
    expect(countBookingOrder(["A", "SMALL"], order)).toEqual({
      fifo: 1,
      clinical: 0,
      optimization: 1,
      unexplained: 0,
    });
  });
});

describe("findUnexplainedPutOffs", () => {
  const held = makeCase("HELD", -30);
  const b = makeCase("B", -5);
  const base = {
    slates: [{ dateISO: DAY1, cases: [b] }],
    candidates: [held, b],
    priorityMode: "urgency_then_ttt" as const,
    heldBack: { HELD: true },
  };

  it("reports a held-back patient who ranks ahead of someone booked instead", () => {
    expect(findUnexplainedPutOffs(base)).toEqual([
      { caseId: "HELD", kind: "held_back", slateDates: [DAY1] },
    ]);
  });

  it("drops them once there is a recorded reason", () => {
    expect(
      findUnexplainedPutOffs({ ...base, reasons: { HELD: { code: "patient_deferred" } } })
    ).toEqual([]);
  });

  it("accepts a clinical flag on them as the reason", () => {
    const flagged = makeCase("HELD", -30, { flags: { outOfTown: true } });
    expect(findUnexplainedPutOffs({ ...base, candidates: [flagged, b] })).toEqual([]);
  });

  it("ignores a hold-back with no consequence", () => {
    // HELD ranks below everyone who is booked, so nobody was booked instead.
    const low = makeCase("HELD", 30);
    expect(findUnexplainedPutOffs({ ...base, candidates: [low, b] })).toEqual([]);
  });

  it("ignores a held-back patient who could not have had the date anyway", () => {
    const away = makeCase("HELD", -30, { unavailableUntil: "2026-02-01" });
    expect(findUnexplainedPutOffs({ ...base, candidates: [away, b] })).toEqual([]);
  });

  it("reports a patient dragged to a later slate, against the earlier one only", () => {
    const delayed = makeCase("DELAYED", -30);
    const later = makeCase("L", 10);
    const result = findUnexplainedPutOffs({
      slates: [
        { dateISO: DAY1, cases: [b] },
        { dateISO: DAY2, cases: [delayed, later] },
      ],
      candidates: [delayed, b, later],
      priorityMode: "urgency_then_ttt",
      manualPlacements: { DELAYED: DAY2 },
    });
    expect(result).toEqual([{ caseId: "DELAYED", kind: "moved_later", slateDates: [DAY1] }]);
  });

  it("does not report a patient the app itself placed later", () => {
    const big = makeCase("BIG", -30);
    expect(
      findUnexplainedPutOffs({
        slates: [
          { dateISO: DAY1, cases: [b] },
          { dateISO: DAY2, cases: [big] },
        ],
        candidates: [big, b],
        priorityMode: "urgency_then_ttt",
      })
    ).toEqual([]);
  });

  it("lists every slate a held-back patient was passed on", () => {
    const c = makeCase("C", 0);
    const result = findUnexplainedPutOffs({
      ...base,
      slates: [
        { dateISO: DAY1, cases: [b] },
        { dateISO: DAY2, cases: [c] },
      ],
      candidates: [held, b, c],
    });
    expect(result[0].slateDates).toEqual([DAY1, DAY2]);
  });

  it("words the export line for one and for several", () => {
    expect(unexplainedPutOffNote(0)).toBe("");
    expect(unexplainedPutOffNote(1)).toBe("1 higher-ranked patient held back, no reason recorded");
    expect(unexplainedPutOffNote(3)).toBe(
      "3 higher-ranked patients held back, no reason recorded"
    );
  });
});

describe("parseOrderReason", () => {
  it("keeps a known code and trims the note", () => {
    expect(parseOrderReason({ code: "resources", note: "  laser booked  " })).toEqual({
      code: "resources",
      note: "laser booked",
    });
  });

  it("drops an empty note", () => {
    expect(parseOrderReason({ code: "resources", note: "   " })).toEqual({ code: "resources" });
  });

  it("caps the note length", () => {
    const parsed = parseOrderReason({ code: "resources", note: "x".repeat(500) });
    expect(parsed?.note).toHaveLength(ORDER_REASON_NOTE_MAX);
  });

  it("rejects an unknown code or a malformed value", () => {
    expect(parseOrderReason({ code: "made_up" })).toBeUndefined();
    expect(parseOrderReason("resources")).toBeUndefined();
    expect(parseOrderReason(null)).toBeUndefined();
  });
});
