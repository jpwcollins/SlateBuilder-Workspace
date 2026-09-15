import { describe, expect, it } from "vitest";
import {
  applyAnnotations,
  collectAnnotations,
  fingerprintWaitlist,
  isAnnotationsFile,
  isClearedAnnotation,
  mergeAnnotations,
  stablePatientKey,
  ANNOTATIONS_KIND,
} from "./annotations";
import { PatientCase } from "./types";

function makeCase(over: Partial<PatientCase> & { caseId: string }): PatientCase {
  return {
    caseId: over.caseId,
    sourceKey: over.sourceKey ?? over.caseId,
    displayLabel: over.displayLabel ?? `Patient ${over.sourceKey ?? over.caseId}`,
    patientRef: over.patientRef,
    benchmarkWeeks: over.benchmarkWeeks ?? 4,
    timeToTargetDays: over.timeToTargetDays ?? 10,
    estimatedDurationMin: over.estimatedDurationMin ?? 90,
    surgeonId: over.surgeonId ?? "Dr Collins",
    procedureName: over.procedureName ?? "Laparoscopy",
    inpatient: over.inpatient ?? false,
    flags: over.flags ?? {},
    unavailableUntil: over.unavailableUntil,
  } as PatientCase;
}

describe("stablePatientKey", () => {
  it("prefers the PHN and ignores its formatting", () => {
    const a = makeCase({ caseId: "C-001", sourceKey: "Kaur, H", patientRef: "9876-543 210" });
    const b = makeCase({ caseId: "C-007", sourceKey: "Kaur, Harpreet", patientRef: "9876543210" });
    expect(stablePatientKey(a)).toBe("phn:9876543210");
    // Same patient, different row and differently-typed name: still matches.
    expect(stablePatientKey(a)).toBe(stablePatientKey(b));
  });

  it("falls back to the name when no PHN is present", () => {
    const item = makeCase({ caseId: "C-001", sourceKey: "Kaur, Harpreet" });
    expect(stablePatientKey(item)).toBe("name:kaur, harpreet");
  });

  it("refuses positional fallback identifiers", () => {
    // These describe a row, not a person — matching on them would move one
    // patient's notes onto whoever lands on that row next week.
    expect(stablePatientKey(makeCase({ caseId: "C-001", sourceKey: "row-3" }))).toBeNull();
    expect(stablePatientKey(makeCase({ caseId: "C-001", sourceKey: "Office row 12" }))).toBeNull();
    expect(stablePatientKey(makeCase({ caseId: "C-001", sourceKey: "  " }))).toBeNull();
  });
});

describe("collect + apply round trip", () => {
  const week1 = [
    makeCase({ caseId: "C-001", sourceKey: "Kaur", patientRef: "9000000001" }),
    makeCase({ caseId: "C-002", sourceKey: "Osei", patientRef: "9000000002" }),
    makeCase({ caseId: "C-003", sourceKey: "Rossi", patientRef: "9000000003" }),
  ];

  const edits = {
    durationOverrides: { "C-001": 120 },
    unavailableOverrides: { "C-002": "2026-09-01" },
    flagOverrides: { "C-001": { osa: true } },
    removedFromSlateSuggestions: {},
    removedFromWaitlist: { "C-003": true },
  };

  it("carries each patient's notes onto their new case code after a re-upload", () => {
    const saved = collectAnnotations(week1, edits);

    // Next week: same patients, different row order, one gone, one new.
    const week2 = [
      makeCase({ caseId: "C-001", sourceKey: "Silva", patientRef: "9000000009" }),
      makeCase({ caseId: "C-002", sourceKey: "Osei", patientRef: "9000000002" }),
      makeCase({ caseId: "C-003", sourceKey: "Kaur", patientRef: "9000000001" }),
    ];
    const applied = applyAnnotations(week2, saved);

    expect(applied.matched).toBe(2);
    // Kaur moved from row 1 to row 3; her notes moved with her.
    expect(applied.durationOverrides).toEqual({ "C-003": 120 });
    expect(applied.flagOverrides).toEqual({ "C-003": { osa: true } });
    // Osei stayed put.
    expect(applied.unavailableOverrides).toEqual({ "C-002": "2026-09-01" });
    // The new patient on row 1 inherits nothing from the departed Kaur.
    expect(applied.durationOverrides["C-001"]).toBeUndefined();
    expect(applied.flagOverrides["C-001"]).toBeUndefined();
  });

  it("drops notes for patients no longer on the list", () => {
    const saved = collectAnnotations(week1, edits);
    // Rossi (removed-from-waitlist) is gone from this week's file entirely.
    const week2 = [makeCase({ caseId: "C-001", sourceKey: "Osei", patientRef: "9000000002" })];
    const applied = applyAnnotations(week2, saved);
    expect(applied.matched).toBe(1);
    expect(Object.keys(applied.removedFromWaitlist)).toHaveLength(0);
  });

  it("records nothing for patients with no edits", () => {
    const saved = collectAnnotations(week1, edits);
    // Only the three edited patients appear; untouched ones are absent.
    expect(Object.keys(saved).sort()).toEqual([
      "phn:9000000001",
      "phn:9000000002",
      "phn:9000000003",
    ]);
  });

  it("never stores names or diagnoses alongside the notes", () => {
    const saved = collectAnnotations(week1, edits);
    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain("Kaur");
    expect(serialized).not.toContain("Laparoscopy");
  });
});

describe("isAnnotationsFile", () => {
  it("accepts a well-formed file and rejects anything else", () => {
    expect(
      isAnnotationsFile({
        v: 1,
        kind: ANNOTATIONS_KIND,
        updatedAt: "2026-09-15T00:00:00.000Z",
        annotations: {},
      })
    ).toBe(true);
    expect(isAnnotationsFile({ v: 1, kind: "something-else", annotations: {} })).toBe(false);
    expect(isAnnotationsFile(null)).toBe(false);
  });
});

describe("timestamps and clearing", () => {
  const cases = [
    makeCase({ caseId: "C-001", sourceKey: "Kaur", patientRef: "9000000001" }),
    makeCase({ caseId: "C-002", sourceKey: "Osei", patientRef: "9000000002" }),
  ];

  it("preserves each patient's own edit time rather than the time of saving", () => {
    const saved = collectAnnotations(
      cases,
      {
        durationOverrides: { "C-001": 120 },
        unavailableOverrides: { "C-002": "2026-09-01" },
        flagOverrides: {},
        removedFromSlateSuggestions: {},
        removedFromWaitlist: {},
      },
      {
        "C-001": { at: "2026-09-01T10:00:00.000Z", by: "MOA" },
        "C-002": { at: "2026-09-08T14:30:00.000Z" },
      }
    );
    expect(saved["phn:9000000001"].updatedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(saved["phn:9000000001"].updatedBy).toBe("MOA");
    expect(saved["phn:9000000002"].updatedAt).toBe("2026-09-08T14:30:00.000Z");
  });

  it("records a cleared patient as an empty entry instead of dropping them", () => {
    // C-001 has a known edit time but no notes left: someone cleared them.
    const saved = collectAnnotations(
      cases,
      {
        durationOverrides: {},
        unavailableOverrides: {},
        flagOverrides: {},
        removedFromSlateSuggestions: {},
        removedFromWaitlist: {},
      },
      { "C-001": { at: "2026-09-10T09:00:00.000Z" } }
    );
    expect(saved["phn:9000000001"]).toBeDefined();
    expect(isClearedAnnotation(saved["phn:9000000001"])).toBe(true);
    // C-002 never had notes, so it is absent entirely.
    expect(saved["phn:9000000002"]).toBeUndefined();
  });

  it("applies nothing for a cleared entry but still carries its timestamp", () => {
    const applied = applyAnnotations(cases, {
      "phn:9000000001": { updatedAt: "2026-09-10T09:00:00.000Z" },
    });
    expect(applied.matched).toBe(0);
    expect(applied.durationOverrides).toEqual({});
    expect(applied.times["C-001"].at).toBe("2026-09-10T09:00:00.000Z");
  });
});

describe("mergeAnnotations", () => {
  const early = "2026-09-01T10:00:00.000Z";
  const late = "2026-09-08T10:00:00.000Z";

  it("takes the newer entry for a patient edited on both sides", () => {
    const mine = { "phn:1": { durationOverrideMin: 90, updatedAt: early } };
    const theirs = { "phn:1": { durationOverrideMin: 150, updatedAt: late } };
    const r = mergeAnnotations(mine, theirs);
    expect(r.annotations["phn:1"].durationOverrideMin).toBe(150);
    expect(r.taken).toBe(1);
    expect(r.kept).toBe(0);
  });

  it("keeps mine when mine is newer", () => {
    const mine = { "phn:1": { durationOverrideMin: 150, updatedAt: late } };
    const theirs = { "phn:1": { durationOverrideMin: 90, updatedAt: early } };
    const r = mergeAnnotations(mine, theirs);
    expect(r.annotations["phn:1"].durationOverrideMin).toBe(150);
    expect(r.kept).toBe(1);
  });

  it("is order-independent — the whole point of merging", () => {
    const a = {
      "phn:1": { durationOverrideMin: 90, updatedAt: early },
      "phn:2": { unavailableUntil: "2026-10-01", updatedAt: late },
    };
    const b = {
      "phn:1": { durationOverrideMin: 150, updatedAt: late },
      "phn:3": { removedFromWaitlist: true as const, updatedAt: early },
    };
    const ab = mergeAnnotations(a, b).annotations;
    const ba = mergeAnnotations(b, a).annotations;
    expect(ab).toEqual(ba);
    expect(ab["phn:1"].durationOverrideMin).toBe(150);
  });

  it("does not let an older file resurrect notes someone cleared", () => {
    // They cleared this patient after I set the override.
    const mine = { "phn:1": { durationOverrideMin: 90, updatedAt: early } };
    const theirs = { "phn:1": { updatedAt: late } };
    const r = mergeAnnotations(mine, theirs);
    expect(isClearedAnnotation(r.annotations["phn:1"])).toBe(true);
    expect(r.annotations["phn:1"].durationOverrideMin).toBeUndefined();
  });

  it("brings across patients the other side knows about and I do not", () => {
    const r = mergeAnnotations({}, { "phn:9": { unavailableUntil: "2026-12-01", updatedAt: late } });
    expect(r.added).toBe(1);
    expect(r.annotations["phn:9"].unavailableUntil).toBe("2026-12-01");
  });

  it("treats reloading the same file as a no-op", () => {
    const file = { "phn:1": { durationOverrideMin: 90, updatedAt: early } };
    const r = mergeAnnotations(file, file);
    expect(r.annotations).toEqual(file);
    expect(r.taken).toBe(0);
    expect(r.added).toBe(0);
  });
});

describe("fingerprintWaitlist", () => {
  it("is stable for the same cohort regardless of row order", () => {
    const a = [
      makeCase({ caseId: "C-001", sourceKey: "Kaur", patientRef: "9000000001" }),
      makeCase({ caseId: "C-002", sourceKey: "Osei", patientRef: "9000000002" }),
    ];
    const b = [
      makeCase({ caseId: "C-001", sourceKey: "Osei", patientRef: "9000000002" }),
      makeCase({ caseId: "C-002", sourceKey: "Kaur", patientRef: "9000000001" }),
    ];
    expect(fingerprintWaitlist(a)).toBe(fingerprintWaitlist(b));
  });

  it("differs when the cohort differs", () => {
    const a = [makeCase({ caseId: "C-001", sourceKey: "Kaur", patientRef: "9000000001" })];
    const b = [makeCase({ caseId: "C-001", sourceKey: "Silva", patientRef: "9000000009" })];
    expect(fingerprintWaitlist(a)).not.toBe(fingerprintWaitlist(b));
  });
});

describe("merge tie-breaks", () => {
  const same = "2026-09-05T12:00:00.000Z";

  it("prefers real notes over a clearing recorded at the same instant", () => {
    // This is the shape a stale timestamp produces: a tombstone carrying the
    // same time as the entry it shadows. It must not win.
    const localTombstone = { "phn:1": { updatedAt: same } };
    const incomingWithNotes = { "phn:1": { unavailableUntil: "2026-12-01", updatedAt: same } };
    const r = mergeAnnotations(localTombstone, incomingWithNotes);
    expect(r.annotations["phn:1"].unavailableUntil).toBe("2026-12-01");
    expect(r.taken).toBe(1);
  });

  it("still treats an identical entry as unchanged", () => {
    const entry = { "phn:1": { unavailableUntil: "2026-12-01", updatedAt: same } };
    const r = mergeAnnotations(entry, { ...entry });
    expect(r.unchanged).toBe(1);
    expect(r.taken).toBe(0);
  });
});
