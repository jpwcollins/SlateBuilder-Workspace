import { describe, expect, it } from "vitest";
import { checkImportedWaitlist, ImportCheckId, summarizeImport } from "./importCheck";
import { parseCsv } from "./csv";
import { PatientCase } from "./types";

function patient(overrides: Partial<PatientCase> = {}, index = 1): PatientCase {
  return {
    caseId: `C-${String(index).padStart(3, "0")}`,
    sourceKey: `Patient ${index}`,
    displayLabel: `Patient ${index}`,
    patientRef: `900000000${index}`,
    benchmarkWeeks: 12,
    timeToTargetDays: -30,
    estimatedDurationMin: 60,
    surgeonId: "DR001",
    procedureName: "Laparoscopic Myomectomy",
    flags: {},
    ...overrides,
  };
}

/** A believable list: a mix of overdue and not, varied procedures and waits. */
function ordinaryWaitlist(count = 20): PatientCase[] {
  const procedures = ["Hysteroscopy", "Laparoscopic Myomectomy", "Total Hysterectomy"];
  return Array.from({ length: count }, (_, i) =>
    patient(
      {
        procedureName: procedures[i % procedures.length],
        estimatedDurationMin: 30 + (i % 3) * 45,
        benchmarkWeeks: ([2, 4, 6, 12, 26] as const)[i % 5],
        // Roughly half past target, by ordinary amounts.
        timeToTargetDays: i % 2 === 0 ? -(10 + i * 3) : 15 + i * 2,
      },
      i + 1
    )
  );
}

function ids(checks: { id: ImportCheckId }[]): ImportCheckId[] {
  return checks.map((check) => check.id);
}

describe("checkImportedWaitlist", () => {
  it("stays silent on an ordinary waitlist", () => {
    // The most important test here. A check that fires on a normal Monday
    // trains people to dismiss the panel without reading it, which is worse
    // than having no checks at all.
    expect(checkImportedWaitlist({ cases: ordinaryWaitlist(), rowsRead: 20 })).toEqual([]);
  });

  it("says nothing at all about an empty list", () => {
    expect(checkImportedWaitlist({ cases: [] })).toEqual([]);
  });

  it("catches the units error that made every wait look seven times shorter", () => {
    // The bug that motivated this module: a hospital export writes TIME_WAITING
    // in weeks, the parser read it as days, and a list that was two-thirds
    // overdue rendered as nobody overdue -- with clean, confident slates.
    const deflated = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, timeToTargetDays: 60 + i }, i + 1)
    );
    expect(ids(checkImportedWaitlist({ cases: deflated }))).toContain("none-overdue");
  });

  it("catches the same error in the other direction", () => {
    const inflated = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, timeToTargetDays: -(400 + i * 7) }, i + 1)
    );
    expect(ids(checkImportedWaitlist({ cases: inflated }))).toContain("all-overdue");
  });

  it("does not flag a genuinely backlogged list where everyone is modestly overdue", () => {
    // 100% overdue is real in a busy practice. Only implausible magnitudes
    // point at a units error, so only those are worth a question.
    const backlogged = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, timeToTargetDays: -(20 + i * 5) }, i + 1)
    );
    expect(ids(checkImportedWaitlist({ cases: backlogged }))).not.toContain("all-overdue");
  });

  it("ignores wait distribution on a short list", () => {
    const few = ordinaryWaitlist(5).map((item, i) =>
      patient({ ...item, timeToTargetDays: 30 }, i + 1)
    );
    expect(ids(checkImportedWaitlist({ cases: few }))).not.toContain("none-overdue");
  });

  it("reports rows that never became patients, with their row numbers", () => {
    const checks = checkImportedWaitlist({
      cases: ordinaryWaitlist(),
      rowsRead: 22,
      skipped: [
        { row: 4, reason: "no-wait-information" },
        { row: 9, reason: "unrecognized-benchmark", offendingValue: "urgent" },
      ],
    });
    const dropped = checks.find((check) => check.id === "rows-dropped");
    expect(dropped?.severity).toBe("serious");
    expect(dropped?.headline).toContain("2 patients");
    expect(dropped?.headline).toContain("20 of 22");
    expect(dropped?.detail).toContain("4, 9");
  });

  it("catches a procedure column that did not match, which fakes every case length", () => {
    const nameless = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, procedureName: "" }, i + 1)
    );
    const checks = checkImportedWaitlist({ cases: nameless });
    expect(ids(checks)).toContain("no-procedure-names");
    // The uniform-duration check would be a second voice saying the same
    // thing, so it stays quiet once the cause has been named.
    expect(ids(checks)).not.toContain("uniform-duration");
  });

  it("notes when procedures loaded but all fell back to one duration", () => {
    const uniform = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, procedureName: "Unknown Operation", estimatedDurationMin: 90 }, i + 1)
    );
    expect(ids(checkImportedWaitlist({ cases: uniform }))).toContain("uniform-duration");
  });

  it("warns when patients have no identity, because notes will not come back", () => {
    const anonymous = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, patientRef: undefined, sourceKey: `row-${i + 1}` }, i + 1)
    );
    const checks = checkImportedWaitlist({ cases: anonymous });
    expect(ids(checks)).toContain("no-patient-identity");
    expect(checks.find((c) => c.id === "no-patient-identity")?.severity).toBe("serious");
  });

  it("flags a patient listed twice, since notes are shared between their rows", () => {
    const cases = ordinaryWaitlist();
    cases[3] = patient({ ...cases[3], patientRef: cases[0].patientRef }, 4);
    expect(ids(checkImportedWaitlist({ cases }))).toContain("duplicate-patients");
  });

  it("flags a wait that could not be real", () => {
    const cases = ordinaryWaitlist();
    cases[2] = patient({ ...cases[2], timeToTargetDays: -40000 }, 3);
    const checks = checkImportedWaitlist({ cases });
    expect(ids(checks)).toContain("implausible-wait");
    expect(checks.find((c) => c.id === "implausible-wait")?.headline).toContain("ten years");
  });

  it("puts serious findings first", () => {
    const cases = ordinaryWaitlist().map((item, i) =>
      patient({ ...item, procedureName: "", timeToTargetDays: 50 }, i + 1)
    );
    const checks = checkImportedWaitlist({ cases, rowsRead: 21, skipped: [{ row: 7, reason: "no-wait-information" }] });
    expect(checks[0].severity).toBe("serious");
    expect(checks[checks.length - 1].severity).toBe("check");
  });

  it("runs end to end on a file whose waiting column is misread", () => {
    // Same 12 patients, same file, one header difference. The weeks version is
    // the truth; the days version is what the bug produced.
    const rows = Array.from({ length: 12 }, (_, i) => `P${i},12w,${20 + i},Hysteroscopy`);
    const asWeeks = parseCsv(
      ["source_key,benchmark,time_waiting_weeks,procedure_name", ...rows].join("\n")
    );
    const asDays = parseCsv(
      ["source_key,benchmark,time_waiting_days,procedure_name", ...rows].join("\n")
    );

    expect(ids(checkImportedWaitlist(asWeeks))).not.toContain("none-overdue");
    expect(ids(checkImportedWaitlist(asDays))).toContain("none-overdue");
  });
});

describe("summarizeImport", () => {
  it("states the reading in one line", () => {
    const line = summarizeImport(ordinaryWaitlist()).line;
    expect(line).toContain("20 patients");
    expect(line).toContain("past target");
    expect(line).toMatch(/median (\d+ weeks? (past|before)|right on) target/);
  });

  it("reads differently for the same list under a units error", () => {
    // The gap this line exists to close: a seven-fold deflation that still
    // leaves a few patients overdue passes every aggregate threshold, because
    // nothing in the app knows what the answer should be. The person whose
    // waitlist it is does, and can see it here at a glance.
    const truth = Array.from({ length: 20 }, (_, i) =>
      patient({ benchmarkWeeks: 12, timeToTargetDays: 84 - (14 + i * 3) * 7 }, i + 1)
    );
    const deflated = Array.from({ length: 20 }, (_, i) =>
      patient({ benchmarkWeeks: 12, timeToTargetDays: 84 - (14 + i * 3) }, i + 1)
    );

    expect(summarizeImport(truth).line).toContain("20 past target");
    expect(summarizeImport(deflated).overdue).toBeLessThan(5);
    expect(summarizeImport(deflated).line).toContain("before target");
  });

  it("does not claim a longest wait when nobody is overdue", () => {
    const none = Array.from({ length: 10 }, (_, i) => patient({ timeToTargetDays: 40 }, i + 1));
    const summary = summarizeImport(none);
    expect(summary.overdue).toBe(0);
    expect(summary.line).not.toContain("longest");
  });

  it("returns an empty line for an empty list", () => {
    expect(summarizeImport([]).line).toBe("");
  });
});
