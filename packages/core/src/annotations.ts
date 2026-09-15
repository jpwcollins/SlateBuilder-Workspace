// The office's own notes about patients, kept separately from the hospital's
// waitlist.
//
// SlateBuilder holds no patient list of its own: the authoritative list is
// whatever the hospital sent this week, and it is re-uploaded each time. What
// the office accumulates on top of that — "this patient is away until August",
// "this one needs the longer slot", "this one has sleep apnea" — is the only
// thing worth carrying week to week, so it is the only thing saved.
//
// Consequences that matter:
//   * The saved file contains PHNs and clinical flags. It is a health record
//     and needs handling as one. It does NOT contain names, diagnoses, or the
//     waitlist itself.
//   * Because it holds no patient list, it cannot silently go stale or become
//     a parallel record of who is waiting. Notes for patients no longer on the
//     hospital's list are simply ignored on load.

import { ClinicalFlagKey, DefaultDurations, PatientCase, PriorityMode } from "./types";
import { normalizePhn } from "./security";

/** One patient's accumulated office edits. */
export type PatientAnnotation = {
  unavailableUntil?: string;
  durationOverrideMin?: number;
  flags?: Partial<Record<ClinicalFlagKey, boolean>>;
  removedFromSlates?: boolean;
  removedFromWaitlist?: boolean;
};

export type AnnotationsFile = {
  v: 1;
  kind: "slatebuilder-office-annotations";
  updatedAt: string;
  /** Keyed by stablePatientKey — PHN where available, else name. */
  annotations: Record<string, PatientAnnotation>;
  settings?: {
    defaultDurations: DefaultDurations;
    priorityMode: PriorityMode;
    slateCount: number;
  };
};

export const ANNOTATIONS_KIND = "slatebuilder-office-annotations";

/**
 * A patient's identity independent of their row position in the uploaded file.
 *
 * Case codes (C-001, C-002…) are assigned by row order on every parse, so they
 * describe a position, not a person — matching on them would reattach one
 * patient's notes to whoever happens to land on that row next week. PHN is the
 * real identity; the name is a fallback for files that lack one.
 *
 * Returns null for the parser's positional fallbacks (row-N / "Office row N"),
 * which carry no identity at all and must never be matched on.
 */
export function stablePatientKey(item: PatientCase): string | null {
  const phn = normalizePhn(item.patientRef ?? "");
  if (phn) return `phn:${phn}`;
  const key = item.sourceKey?.trim();
  if (!key || /^row-\d+$/i.test(key) || /^office row \d+$/i.test(key)) return null;
  return `name:${key.toLowerCase()}`;
}

/** Collects the non-empty annotations for the given cases, keyed by identity. */
export function collectAnnotations(
  cases: PatientCase[],
  source: {
    durationOverrides: Record<string, number>;
    unavailableOverrides: Record<string, string>;
    flagOverrides: Record<string, Partial<Record<ClinicalFlagKey, boolean>>>;
    removedFromSlateSuggestions: Record<string, boolean>;
    removedFromWaitlist: Record<string, boolean>;
  }
): Record<string, PatientAnnotation> {
  const out: Record<string, PatientAnnotation> = {};
  for (const item of cases) {
    const key = stablePatientKey(item);
    if (!key) continue;
    const entry: PatientAnnotation = {};
    if (source.durationOverrides[item.caseId] !== undefined) {
      entry.durationOverrideMin = source.durationOverrides[item.caseId];
    }
    if (source.unavailableOverrides[item.caseId]) {
      entry.unavailableUntil = source.unavailableOverrides[item.caseId];
    }
    if (source.flagOverrides[item.caseId]) entry.flags = source.flagOverrides[item.caseId];
    if (source.removedFromSlateSuggestions[item.caseId]) entry.removedFromSlates = true;
    if (source.removedFromWaitlist[item.caseId]) entry.removedFromWaitlist = true;
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return out;
}

export type AppliedAnnotations = {
  durationOverrides: Record<string, number>;
  unavailableOverrides: Record<string, string>;
  flagOverrides: Record<string, Partial<Record<ClinicalFlagKey, boolean>>>;
  removedFromSlateSuggestions: Record<string, boolean>;
  removedFromWaitlist: Record<string, boolean>;
  /** How many of the given cases were recognised and had notes applied. */
  matched: number;
};

/**
 * Re-keys saved annotations onto the case codes of a freshly parsed file.
 * Notes for patients not present in `cases` are dropped rather than retained,
 * so the result never describes anyone who is not on this week's list.
 */
export function applyAnnotations(
  cases: PatientCase[],
  annotations: Record<string, PatientAnnotation>
): AppliedAnnotations {
  const applied: AppliedAnnotations = {
    durationOverrides: {},
    unavailableOverrides: {},
    flagOverrides: {},
    removedFromSlateSuggestions: {},
    removedFromWaitlist: {},
    matched: 0,
  };
  for (const item of cases) {
    const key = stablePatientKey(item);
    const entry = key ? annotations[key] : undefined;
    if (!entry) continue;
    applied.matched += 1;
    if (entry.durationOverrideMin !== undefined) {
      applied.durationOverrides[item.caseId] = entry.durationOverrideMin;
    }
    if (entry.unavailableUntil) applied.unavailableOverrides[item.caseId] = entry.unavailableUntil;
    if (entry.flags) applied.flagOverrides[item.caseId] = entry.flags;
    if (entry.removedFromSlates) applied.removedFromSlateSuggestions[item.caseId] = true;
    if (entry.removedFromWaitlist) applied.removedFromWaitlist[item.caseId] = true;
  }
  return applied;
}

export function isAnnotationsFile(value: unknown): value is AnnotationsFile {
  const v = value as AnnotationsFile;
  return (
    typeof value === "object" &&
    value !== null &&
    v.kind === ANNOTATIONS_KIND &&
    typeof v.annotations === "object" &&
    v.annotations !== null
  );
}
