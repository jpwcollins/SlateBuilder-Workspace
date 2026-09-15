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

/**
 * One patient's accumulated office edits.
 *
 * `updatedAt` is what makes two files mergeable: when the same patient appears
 * in both, the newer entry wins. An entry with no other fields set is not
 * meaningless — it records that someone deliberately cleared this patient's
 * notes, and must be kept so a merge does not resurrect them from an older
 * file. Clearing therefore writes an empty entry rather than deleting the key.
 */
export type PatientAnnotation = {
  unavailableUntil?: string;
  durationOverrideMin?: number;
  flags?: Partial<Record<ClinicalFlagKey, boolean>>;
  removedFromSlates?: boolean;
  removedFromWaitlist?: boolean;
  /** ISO timestamp of when this patient's notes last changed. */
  updatedAt: string;
  /** Free-text label for whoever changed them, e.g. "MOA". */
  updatedBy?: string;
};

/** True when an entry carries no actual notes — a record of clearing. */
export function isClearedAnnotation(entry: PatientAnnotation): boolean {
  return (
    entry.unavailableUntil === undefined &&
    entry.durationOverrideMin === undefined &&
    entry.flags === undefined &&
    !entry.removedFromSlates &&
    !entry.removedFromWaitlist
  );
}

export type AnnotationsFile = {
  v: 1;
  kind: "slatebuilder-office-annotations";
  updatedAt: string;
  /**
   * Increments on every save. Lets the app notice that the file it is about to
   * load is older than one it has already seen, or that someone else has saved
   * over a shared file since it was opened.
   */
  revision: number;
  /** Free-text label for whoever saved it, e.g. "MOA" or "JC". */
  savedBy?: string;
  /** Which waitlist this was last worked against — provenance, not a lock. */
  waitlist?: {
    fingerprint: string;
    patientCount: number;
  };
  /** Keyed by stablePatientKey — PHN where available, else name. */
  annotations: Record<string, PatientAnnotation>;
  settings?: {
    defaultDurations: DefaultDurations;
    priorityMode: PriorityMode;
    slateCount: number;
  };
};

/**
 * A short, stable identifier for "which set of patients is this".
 *
 * Deliberately NOT cryptographic: it exists to tell one weekly file from
 * another in a status line, not to resist tampering. It is computed over the
 * patient identities rather than the raw file text, so reformatting or column
 * reordering does not make the same cohort look like a different one.
 */
export function fingerprintWaitlist(cases: PatientCase[]): string {
  const keys = cases
    .map(stablePatientKey)
    .filter((k): k is string => k !== null)
    .sort();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const source = `${keys.length}:${keys.join("|")}`;
  for (let i = 0; i < source.length; i += 1) {
    const c = source.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12);
}

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

export type AnnotationSource = {
  durationOverrides: Record<string, number>;
  unavailableOverrides: Record<string, string>;
  flagOverrides: Record<string, Partial<Record<ClinicalFlagKey, boolean>>>;
  removedFromSlateSuggestions: Record<string, boolean>;
  removedFromWaitlist: Record<string, boolean>;
};

/** When each patient's notes last changed, keyed by case code. */
export type AnnotationTimes = Record<string, { at: string; by?: string }>;

/**
 * Collects the annotations for the given cases, keyed by patient identity.
 *
 * A patient appears in the result if they currently have notes, or if they are
 * known to have had notes that were since cleared — the latter as an empty
 * entry, so that merging with an older file does not bring the cleared notes
 * back. Patients who never had notes are omitted entirely.
 */
export function collectAnnotations(
  cases: PatientCase[],
  source: AnnotationSource,
  times: AnnotationTimes = {},
  fallbackAt: string = new Date().toISOString()
): Record<string, PatientAnnotation> {
  const out: Record<string, PatientAnnotation> = {};
  for (const item of cases) {
    const key = stablePatientKey(item);
    if (!key) continue;
    const stamp = times[item.caseId];
    const entry: PatientAnnotation = { updatedAt: stamp?.at ?? fallbackAt };
    if (stamp?.by) entry.updatedBy = stamp.by;
    if (source.durationOverrides[item.caseId] !== undefined) {
      entry.durationOverrideMin = source.durationOverrides[item.caseId];
    }
    if (source.unavailableOverrides[item.caseId]) {
      entry.unavailableUntil = source.unavailableOverrides[item.caseId];
    }
    if (source.flagOverrides[item.caseId]) entry.flags = source.flagOverrides[item.caseId];
    if (source.removedFromSlateSuggestions[item.caseId]) entry.removedFromSlates = true;
    if (source.removedFromWaitlist[item.caseId]) entry.removedFromWaitlist = true;
    // Keep it only if it says something: real notes, or a recorded clearing.
    if (!isClearedAnnotation(entry) || stamp) out[key] = entry;
  }
  return out;
}

export type AppliedAnnotations = {
  durationOverrides: Record<string, number>;
  unavailableOverrides: Record<string, string>;
  flagOverrides: Record<string, Partial<Record<ClinicalFlagKey, boolean>>>;
  removedFromSlateSuggestions: Record<string, boolean>;
  removedFromWaitlist: Record<string, boolean>;
  /**
   * The loaded timestamps, re-keyed onto this file's case codes, so that a
   * later save preserves when each patient's notes actually changed instead of
   * restamping everything with the time of the load.
   */
  times: AnnotationTimes;
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
    times: {},
    matched: 0,
  };
  for (const item of cases) {
    const key = stablePatientKey(item);
    const entry = key ? annotations[key] : undefined;
    if (!entry) continue;
    applied.times[item.caseId] = {
      at: entry.updatedAt ?? new Date(0).toISOString(),
      by: entry.updatedBy,
    };
    // A cleared entry carries no notes to apply, but its timestamp still
    // matters: it is what stops an older file reinstating what it cleared.
    if (isClearedAnnotation(entry)) continue;
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

export type MergeOutcome = {
  annotations: Record<string, PatientAnnotation>;
  /** Patients whose entry came from the incoming file. */
  taken: number;
  /** Patients where the local entry was newer and was kept. */
  kept: number;
  /** Patients present only in the incoming file. */
  added: number;
  /** Patients present in both with identical content. */
  unchanged: number;
};

/**
 * Combines two sets of annotations, newest entry wins per patient.
 *
 * This is what makes working asynchronously safe without a server: two people
 * can each save their own file, either can load the other's, and the result is
 * the union rather than whichever was loaded last. Loading order stops
 * mattering, which is the property that replace-semantics cannot offer.
 *
 * The limitation is inherent and worth stating plainly: resolution is per
 * patient and by timestamp, so if two people edit the same patient the later
 * edit wins whether or not it was the more considered one. It also assumes the
 * two machines' clocks roughly agree.
 */
export function mergeAnnotations(
  local: Record<string, PatientAnnotation>,
  incoming: Record<string, PatientAnnotation>
): MergeOutcome {
  const out: Record<string, PatientAnnotation> = { ...local };
  const result: MergeOutcome = { annotations: out, taken: 0, kept: 0, added: 0, unchanged: 0 };

  for (const [key, incomingEntry] of Object.entries(incoming)) {
    const localEntry = local[key];
    if (!localEntry) {
      out[key] = incomingEntry;
      result.added += 1;
      continue;
    }
    const localAt = Date.parse(localEntry.updatedAt ?? "") || 0;
    const incomingAt = Date.parse(incomingEntry.updatedAt ?? "") || 0;
    if (incomingAt > localAt) {
      out[key] = incomingEntry;
      result.taken += 1;
    } else if (incomingAt < localAt) {
      result.kept += 1;
    } else if (isClearedAnnotation(localEntry) && !isClearedAnnotation(incomingEntry)) {
      // Same instant, but one side has notes and the other records a clearing.
      // Prefer the notes: a tie should never be resolved by discarding content.
      out[key] = incomingEntry;
      result.taken += 1;
    } else {
      // Same instant and comparable content: keep the local copy so that
      // reloading the same file is a no-op.
      result.unchanged += 1;
    }
  }
  return result;
}
