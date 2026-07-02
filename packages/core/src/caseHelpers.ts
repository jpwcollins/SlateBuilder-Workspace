import { MAX_CASES_PER_SLATE, priorityScoreOf, TURNAROUND_MINUTES } from "./optimizer";
import { getBlockStartMinutes, normalizeDateOnly } from "./date";
import {
  BENCHMARK_WEEKS_ORDER,
  ClinicalFlagKey,
  DefaultDurations,
  PatientCase,
  PriorityMode,
  ScoredCase,
} from "./types";

/**
 * Whether one more case (of `candidateDurationMin`) fits into a slate that
 * currently holds `currentCount` cases totalling `currentSurgicalMinutes`,
 * given the slate's `blockMinutes`. Shared by every place that adds a single
 * case to a slate one at a time (drag-and-drop, backfill, restore, the
 * unavailable-until re-placement search, and the utilization bin-packer) so
 * the capacity rule only has to be right in one place.
 */
export function caseFitsInSlate(
  currentSurgicalMinutes: number,
  currentCount: number,
  candidateDurationMin: number,
  blockMinutes: number
): boolean {
  if (currentCount + 1 > MAX_CASES_PER_SLATE) return false;
  const occupied =
    currentSurgicalMinutes + candidateDurationMin + TURNAROUND_MINUTES * currentCount;
  return occupied <= blockMinutes;
}

/**
 * Picks a default duration bucket from the free-text procedure name. Shared
 * by both apps so a change to the matching rules (e.g. a new procedure
 * keyword) only needs to be made once.
 */
export function applyDefaultDuration(
  item: PatientCase,
  defaultDurations: DefaultDurations
): PatientCase {
  const name = (item.procedureName ?? "").toLowerCase();
  let duration = defaultDurations.other;
  if (name.includes("hysterectomy")) {
    duration = defaultDurations.hysterectomy;
  } else if (name.includes("hysteroscop")) {
    duration = defaultDurations.hysteroscopy;
  } else if (name.includes("laparoscop")) {
    duration = defaultDurations.laparoscopy;
  }
  return { ...item, estimatedDurationMin: duration };
}

export function applyFlagOverrides(
  item: PatientCase,
  flagOverrides: Record<string, Partial<Record<ClinicalFlagKey, boolean>>>
): PatientCase {
  const override = flagOverrides[item.caseId];
  if (!override) return item;
  return {
    ...item,
    flags: {
      ...item.flags,
      ...override,
    },
  };
}

export function applyUnavailableOverrides(
  item: PatientCase,
  unavailableOverrides: Record<string, string>
): PatientCase {
  const override = unavailableOverrides[item.caseId];
  if (override === undefined) return item;
  return {
    ...item,
    unavailableUntil: normalizeDateOnly(override),
  };
}

/**
 * Waitlist ordering: "ttt" sorts purely by time-to-target; the default
 * ("urgency_then_ttt") uses the same composite priority score the slate
 * optimizer does, with longest wait breaking ties.
 */
export function sortForWaitlist<T extends PatientCase>(
  items: T[],
  priorityMode: PriorityMode
): T[] {
  return [...items].sort((a, b) => {
    if (priorityMode === "ttt") {
      return a.timeToTargetDays - b.timeToTargetDays;
    }
    const diff = priorityScoreOf(b) - priorityScoreOf(a);
    if (diff !== 0) return diff;
    return a.timeToTargetDays - b.timeToTargetDays;
  });
}

/**
 * Running order for a slate's OR day: diabetes/OSA cases are placed first
 * (clinical preference for earlier case time), then by the selected
 * priority mode.
 */
export function sortForSlate(items: ScoredCase[], priorityMode: PriorityMode): ScoredCase[] {
  return [...items].sort((a, b) => {
    const aFlag = a.flags?.diabetes ? 0 : a.flags?.osa ? 1 : 2;
    const bFlag = b.flags?.diabetes ? 0 : b.flags?.osa ? 1 : 2;
    if (aFlag !== bFlag) return aFlag - bFlag;
    if (priorityMode === "ttt") {
      return a.timeToTargetDays - b.timeToTargetDays;
    }
    const aGroup = BENCHMARK_WEEKS_ORDER.indexOf(a.benchmarkWeeks);
    const bGroup = BENCHMARK_WEEKS_ORDER.indexOf(b.benchmarkWeeks);
    if (aGroup !== bGroup) return aGroup - bGroup;
    return a.timeToTargetDays - b.timeToTargetDays;
  });
}

export type ScheduledCase = {
  item: ScoredCase;
  start: number;
  end: number;
  tatAfter: boolean;
  tatEnd: number;
};

/**
 * Lays out a slate's running order into start/end minute-of-day times,
 * inserting a turnaround gap after every case but the last.
 */
export function buildCaseSchedule(items: ScoredCase[], dateISO: string): ScheduledCase[] {
  const date = new Date(`${dateISO}T00:00:00`);
  let cursor = getBlockStartMinutes(date);
  return items.map((item, index) => {
    const start = cursor;
    const end = cursor + Math.round(item.estimatedDurationMin);
    cursor = end;
    const tatAfter = index < items.length - 1;
    const tatEnd = tatAfter ? end + TURNAROUND_MINUTES : end;
    if (tatAfter) cursor = tatEnd;
    return { item, start, end, tatAfter, tatEnd };
  });
}

/** Tailwind classes for the urgency chip, keyed by benchmark class (most urgent = red). */
export function urgencyChipClasses(weeks: number): string {
  if (weeks <= 2) return "bg-rose-100 text-rose-700";
  if (weeks <= 4) return "bg-orange-100 text-orange-700";
  if (weeks <= 6) return "bg-amber-100 text-amber-800";
  if (weeks <= 12) return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-600";
}
