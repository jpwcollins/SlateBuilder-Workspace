import { describe, expect, it } from "vitest";
import {
  applyAnnotations,
  collectAnnotations,
  isAnnotationsFile,
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
