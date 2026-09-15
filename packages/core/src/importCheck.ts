// Does the list that just loaded look like a real waitlist?
//
// Every other validation in this app is about the slates — dates set, no
// duplicates, nothing in the past. Nothing has ever looked at the imported data
// itself, and that is the gap this closes.
//
// The reason is a bug that actually happened. A bare `time_waiting` column was
// read as days when the hospital writes weeks, so every wait was divided by
// seven. The app did not crash or complain: it produced clean, confident,
// well-formatted slates for a list it believed had nobody overdue, when in
// truth two thirds were past target. The output looked exactly as trustworthy
// as correct output. That whole class of failure — a units error, a column that
// silently did not match, a date read as text — is invisible per-patient and
// obvious in aggregate, which is what these checks look at.
//
// Two rules govern what belongs here:
//
//   1. Each check names evidence, not a verdict. "0 of 43 patients are past
//      target" is something the person who knows this waitlist can judge in a
//      second; "import may be invalid" is not.
//   2. A check that fires on normal weeks is worse than no check, because it
//      trains people to dismiss the panel without reading it. Thresholds are
//      set so that a plausible list stays quiet — which is why, for instance,
//      the everybody-overdue check also requires implausible magnitudes: a
//      genuinely backlogged practice can legitimately be 100% overdue.

import { stablePatientKey } from "./annotations";
import { SkippedRow } from "./csv";
import { PatientCase } from "./types";

export type ImportCheckSeverity =
  /** Near-certainly a data fault; slates built on it would be wrong. */
  | "serious"
  /** Unusual enough to be worth one look by someone who knows the list. */
  | "check";

export type ImportCheckId =
  | "rows-dropped"
  | "no-patient-identity"
  | "no-procedure-names"
  | "uniform-duration"
  | "none-overdue"
  | "all-overdue"
  | "implausible-wait"
  | "duplicate-patients";

export type ImportCheck = {
  id: ImportCheckId;
  severity: ImportCheckSeverity;
  /** The observation, in the words a surgeon or MOA would use. */
  headline: string;
  /** What usually causes it, and what to do about it. */
  detail: string;
};

/**
 * A plain statement of how the app read the file that just loaded.
 *
 * This is not a warning and never fires conditionally, which is the point.
 * The checks below can only catch a units error severe enough to push the
 * whole list past a threshold; a partial one — say a list where a seven-fold
 * deflation still leaves a handful of patients overdue — sails through every
 * aggregate test that does not know what the answer should be. Nobody in the
 * building can check that number except the person whose waitlist it is, and
 * they can do it in about a second if they are simply shown it.
 *
 * So the app states what it concluded, every time, in one line: how many are
 * past target, by how much at the extreme, and where the middle of the list
 * sits. A surgeon who reads "median 6 weeks before target" about a list they
 * know to be badly overdue has caught the bug that no threshold would have.
 */
export type ImportSummary = {
  total: number;
  overdue: number;
  /** Weeks past target for the worst-off patient (0 if nobody is overdue). */
  longestOverdueWeeks: number;
  /**
   * Weeks past target at the middle of the list. Negative means the median
   * patient is still within target.
   */
  medianOverdueWeeks: number;
  /** The whole thing as one readable line. */
  line: string;
};

function weeks(days: number): number {
  return Math.round(days / 7);
}

export function summarizeImport(cases: PatientCase[]): ImportSummary {
  const total = cases.length;
  if (total === 0) {
    return { total: 0, overdue: 0, longestOverdueWeeks: 0, medianOverdueWeeks: 0, line: "" };
  }

  const overdueList = cases.filter((item) => item.timeToTargetDays < 0);
  const longestOverdueWeeks = weeks(Math.max(0, ...cases.map(overdueDaysOf)));
  // Past target is positive here, so the median reads the same way round as
  // the rest of the line.
  const medianOverdueWeeks = weeks(median(cases.map((item) => -item.timeToTargetDays)));

  const middle =
    medianOverdueWeeks > 0
      ? `median ${medianOverdueWeeks} ${medianOverdueWeeks === 1 ? "week" : "weeks"} past target`
      : medianOverdueWeeks < 0
        ? `median ${-medianOverdueWeeks} ${medianOverdueWeeks === -1 ? "week" : "weeks"} before target`
        : "median right on target";

  const line = [
    `${plural(total, "patient")}`,
    `${overdueList.length} past target`,
    ...(overdueList.length > 0 ? [`longest by ${plural(longestOverdueWeeks, "week")}`] : []),
    middle,
  ].join(" · ");

  return { total, overdue: overdueList.length, longestOverdueWeeks, medianOverdueWeeks, line };
}

export type ImportCheckInput = {
  cases: PatientCase[];
  /** Data rows read from the file (from ParseResult). */
  rowsRead?: number;
  /** Rows that produced no patient (from ParseResult). */
  skipped?: SkippedRow[];
};

/**
 * Below this, distribution checks are silent: on a handful of patients,
 * "nobody is overdue" is an ordinary Tuesday rather than a signal.
 */
const MIN_CASES_FOR_DISTRIBUTION = 8;

/** Past target by more than this, for everyone, reads as a units error. */
const IMPLAUSIBLE_MEDIAN_OVERDUE_DAYS = 365;

/** No gynaecological waitlist has a patient this far past target. */
const IMPOSSIBLE_OVERDUE_DAYS = 3650;

/** Share of blank procedure names that means the column did not match. */
const BLANK_PROCEDURE_SHARE = 0.8;

/** Share of unidentifiable patients that breaks notes matching. */
const MISSING_IDENTITY_SHARE = 0.5;

function overdueDaysOf(item: PatientCase): number {
  return item.timeToTargetDays < 0 ? -item.timeToTargetDays : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function describeRows(rows: number[]): string {
  const shown = rows.slice(0, 12).join(", ");
  return rows.length > 12 ? `${shown} and ${rows.length - 12} more` : shown;
}

/**
 * Aggregate sanity checks on a freshly imported waitlist.
 *
 * Returns an empty array when the list looks ordinary — the common case, and
 * the one worth optimizing for, since a panel that appears every week stops
 * being read. Results are ordered most serious first.
 */
export function checkImportedWaitlist(input: ImportCheckInput): ImportCheck[] {
  const { cases } = input;
  const skipped = input.skipped ?? [];
  const checks: ImportCheck[] = [];
  const total = cases.length;

  if (total === 0) return checks;

  // --- Did everyone in the file arrive? ------------------------------------
  if (skipped.length > 0) {
    const rowsRead = input.rowsRead ?? total + skipped.length;
    checks.push({
      id: "rows-dropped",
      severity: "serious",
      headline: `${plural(skipped.length, "patient")} in the file did not load (${total} of ${rowsRead} rows).`,
      detail:
        `Skipped rows: ${describeRows(skipped.map((row) => row.row))}. ` +
        "These patients are not on any slate and not on the waitlist — they are not in " +
        "the app at all. Check those rows in the original file for a missing target " +
        "time, a missing waiting time, or an urgency value the app did not recognise.",
    });
  }

  // --- Can notes be matched to these people at all? ------------------------
  const identities = cases.map(stablePatientKey);
  const unidentified = identities.filter((key) => key === null).length;
  if (unidentified / total >= MISSING_IDENTITY_SHARE) {
    checks.push({
      id: "no-patient-identity",
      severity: "serious",
      headline: `${plural(unidentified, "patient")} loaded without a name or PHN.`,
      detail:
        "Notes are matched to patients by PHN, or by name where there is no PHN. " +
        "Patients with neither are numbered by row, so any notes saved against them " +
        "will not come back next week. The uploaded file is probably missing its " +
        "name or PHN column.",
    });
  }

  // --- Are case lengths real, or all the fallback? -------------------------
  const blankProcedures = cases.filter((item) => !(item.procedureName ?? "").trim()).length;
  const proceduresMissing = blankProcedures / total >= BLANK_PROCEDURE_SHARE;
  if (proceduresMissing) {
    checks.push({
      id: "no-procedure-names",
      severity: "serious",
      headline: `No procedure listed for ${plural(blankProcedures, "patient")}.`,
      detail:
        "Case lengths are worked out from the procedure, and fall back to 90 minutes " +
        "when there is none. Every slate timing and every utilisation figure below " +
        "would be built on that fallback rather than on the real operations.",
    });
  } else if (
    total >= MIN_CASES_FOR_DISTRIBUTION &&
    new Set(cases.map((item) => item.estimatedDurationMin)).size === 1
  ) {
    checks.push({
      id: "uniform-duration",
      severity: "check",
      headline: `Every patient has the same case length (${cases[0].estimatedDurationMin} minutes).`,
      detail:
        "Procedure names loaded, but none of them matched a known operation, so they " +
        "all fell back to the same default. Slate timings will be as approximate as " +
        "that default is.",
    });
  }

  // --- Does the amount of waiting look like this practice? -----------------
  if (total >= MIN_CASES_FOR_DISTRIBUTION) {
    const overdue = cases.filter((item) => item.timeToTargetDays < 0);

    if (overdue.length === 0) {
      checks.push({
        id: "none-overdue",
        severity: "check",
        headline: `None of the ${total} patients are past their target date.`,
        detail:
          "That is unusual for a surgical waitlist. If it does not match what you know " +
          "of this list, the most likely cause is the waiting-time column being read in " +
          "the wrong units — weeks as days makes every wait look seven times shorter " +
          "than it is, and nobody appears overdue.",
      });
    } else if (overdue.length === total) {
      const medianOverdue = median(overdue.map(overdueDaysOf));
      if (medianOverdue >= IMPLAUSIBLE_MEDIAN_OVERDUE_DAYS) {
        checks.push({
          id: "all-overdue",
          severity: "check",
          headline: `All ${total} patients are past target, typically by ${Math.round(medianOverdue / 7)} weeks.`,
          detail:
            "A fully overdue list is possible, but this far past target usually means " +
            "the waiting-time column was read in the wrong units — days as weeks makes " +
            "every wait look seven times longer than it is.",
        });
      }
    }

    const impossible = cases.filter((item) => overdueDaysOf(item) > IMPOSSIBLE_OVERDUE_DAYS);
    if (impossible.length > 0) {
      const worst = Math.max(...impossible.map(overdueDaysOf));
      checks.push({
        id: "implausible-wait",
        severity: "check",
        headline: `${plural(impossible.length, "patient")} appear to have waited over ten years.`,
        detail:
          `The longest is ${Math.round(worst / 365)} years past target. That is almost ` +
          "always a date or a number that did not convert properly in the export, rather " +
          "than a real wait. Those patients will sit at the very top of every list.",
      });
    }
  }

  // --- Is anyone on the list twice? ----------------------------------------
  const seen = new Map<string, number>();
  for (const key of identities) {
    if (key === null) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicated = [...seen.values()].filter((count) => count > 1).length;
  if (duplicated > 0) {
    checks.push({
      id: "duplicate-patients",
      severity: "check",
      headline: `${plural(duplicated, "patient")} appear more than once on the list.`,
      detail:
        "That is legitimate when someone is waiting for two operations. Be aware that " +
        "notes — an unavailable date, a changed case length, a clinical flag — are held " +
        "against the patient, so anything noted on one of their rows applies to the other.",
    });
  }

  const order: Record<ImportCheckSeverity, number> = { serious: 0, check: 1 };
  return checks.sort((a, b) => order[a.severity] - order[b.severity]);
}
