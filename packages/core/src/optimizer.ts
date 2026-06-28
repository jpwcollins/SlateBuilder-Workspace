import { getBlockMinutes, isAvailableOnDate, toLocalDateOnly } from "./date";
import { PatientCase, ScoredCase, SlateResult } from "./types";

const urgencyWeightMap: Record<number, number> = {
  2: 5,
  4: 4,
  6: 3,
  12: 2,
  26: 1,
};

/** Minutes of OR turnaround (prep for the next case) after every case but the last. */
export const TURNAROUND_MINUTES = 30;

/** Hard ceiling on cases in a single slate. */
export const MAX_CASES_PER_SLATE = 7;

/**
 * Re-applies a previously saved manual ordering (by caseId) to a freshly
 * optimized slate. Cases named in `orderedIds` come first in that order; any
 * remaining cases keep their incoming order. Used so manual drag-reordering
 * survives re-optimization and saved/restored sessions.
 */
export function reorderSlateByCaseIds(
  items: ScoredCase[],
  orderedIds: string[] | undefined
): ScoredCase[] {
  if (!orderedIds || orderedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.caseId, item]));
  const ordered: ScoredCase[] = [];
  orderedIds.forEach((id) => {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      byId.delete(id);
    }
  });
  items.forEach((item) => {
    if (byId.has(item.caseId)) {
      ordered.push(item);
      byId.delete(item.caseId);
    }
  });
  return ordered;
}

/**
 * Composite priority: clinical urgency × how far through (and past) the target a
 * patient has waited. target = benchmarkWeeks × 7 days; r = waited / target, so
 * r grows every day (FIFO), reaches 1 at target and exceeds 1 once overdue.
 * Breach is normalized to the target, so a breached short-target case outranks a
 * long-overdue long-target one. Independent of the OR day.
 */
export function priorityScoreOf(input: {
  benchmarkWeeks: number;
  timeToTargetDays: number;
}): number {
  const target = input.benchmarkWeeks * 7;
  const urgencyWeight = urgencyWeightMap[input.benchmarkWeeks] ?? 1;
  if (target <= 0) return urgencyWeight;
  const waited = target - input.timeToTargetDays;
  const r = Math.max(0, waited / target);
  return urgencyWeight * (1 + r);
}

export function scoreCases(cases: PatientCase[], _date?: Date): ScoredCase[] {
  return cases.map((item) => ({
    ...item,
    urgencyWeight: urgencyWeightMap[item.benchmarkWeeks] ?? 1,
    overdueDays: Math.max(0, -item.timeToTargetDays),
    priorityScore: priorityScoreOf(item),
  }));
}

const byPriorityThenWait = (a: ScoredCase, b: ScoredCase) =>
  b.priorityScore - a.priorityScore || a.timeToTargetDays - b.timeToTargetDays;

// Occupied OR time for a slate of `count` cases totalling `surgical` minutes:
// surgical plus a 30-min turnaround after every case but the last.
const occupiedFor = (count: number, surgical: number) =>
  surgical + TURNAROUND_MINUTES * Math.max(0, count - 1);

/**
 * Strategy B — anchored hybrid. Cases that are over target (overdue) are placed
 * first, most-urgent first, so the longest-waiting/sickest feasible patients are
 * never bumped to fit less-urgent ones. The remaining block time is then filled
 * with not-yet-overdue cases via a knapsack that maximizes total priority.
 */
export function optimizeSlate(cases: PatientCase[], date: Date): SlateResult {
  const blockMinutes = getBlockMinutes(date);
  const scored = scoreCases(cases, date);
  const TAT = TURNAROUND_MINUTES;

  // Phase 1 — anchor over-target cases greedily by priority.
  const anchors = scored.filter((c) => c.timeToTargetDays < 0).sort(byPriorityThenWait);
  const selected: ScoredCase[] = [];
  let surgical = 0;
  for (const a of anchors) {
    if (selected.length >= MAX_CASES_PER_SLATE) break;
    const dur = Math.round(a.estimatedDurationMin);
    if (occupiedFor(selected.length + 1, surgical + dur) <= blockMinutes) {
      selected.push(a);
      surgical += dur;
    }
  }
  const anchoredCount = selected.length;
  const anchorIds = new Set(selected.map((c) => c.caseId));

  // Phase 2 — fill remaining time/slots with not-yet-overdue cases, maximizing
  // total priority. Each fill case costs duration + TAT; the budget already
  // accounts for the turnaround that joins the anchors to the fill cases.
  const fillCandidates = scored.filter(
    (c) => c.timeToTargetDays >= 0 && !anchorIds.has(c.caseId)
  );
  const slotsLeft = MAX_CASES_PER_SLATE - anchoredCount;
  const budget =
    anchoredCount >= 1
      ? blockMinutes - occupiedFor(anchoredCount, surgical)
      : blockMinutes + TAT;
  const fillSelected = knapsackFill(fillCandidates, Math.max(0, budget), slotsLeft);
  selected.push(...fillSelected);

  selected.sort(byPriorityThenWait);
  const selectedIds = new Set(selected.map((c) => c.caseId));
  const remaining = scored.filter((c) => !selectedIds.has(c.caseId));

  const totalMinutes = selected.reduce((sum, item) => sum + item.estimatedDurationMin, 0);
  const turnaroundMinutes = TAT * Math.max(0, selected.length - 1);
  const totalPriorityScore = selected.reduce((sum, item) => sum + item.priorityScore, 0);
  const occupiedMinutes = totalMinutes + turnaroundMinutes;
  const utilizationPct = blockMinutes > 0 ? (occupiedMinutes / blockMinutes) * 100 : 0;

  return {
    dateISO: toLocalDateOnly(date),
    blockMinutes,
    totalMinutes,
    turnaroundMinutes,
    utilizationPct,
    totalPriorityScore,
    anchoredCount,
    selected,
    remaining,
  };
}

/**
 * 0/1 knapsack maximizing total priority subject to a minute budget and a slot
 * cap. Each item's weight is duration + TAT (see optimizeSlate for why).
 */
function knapsackFill(
  candidates: ScoredCase[],
  budget: number,
  slots: number
): ScoredCase[] {
  const n = candidates.length;
  const cap = Math.floor(budget);
  if (n === 0 || slots <= 0 || cap <= 0) return [];

  const weights = candidates.map((c) => Math.round(c.estimatedDurationMin) + TURNAROUND_MINUTES);
  const values = candidates.map((c) => c.priorityScore);

  const dp: Float64Array[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: cap + 1 }, () => new Float64Array(slots + 1))
  );

  for (let i = 1; i <= n; i += 1) {
    const weight = weights[i - 1];
    const value = values[i - 1];
    const prev = dp[i - 1];
    const curr = dp[i];
    for (let w = 0; w <= cap; w += 1) {
      const prevW = prev[w];
      const prevFit = weight <= w ? prev[w - weight] : null;
      const currW = curr[w];
      for (let k = 0; k <= slots; k += 1) {
        let best = prevW[k];
        if (prevFit && k >= 1) {
          const candidate = prevFit[k - 1] + value;
          if (candidate > best) best = candidate;
        }
        currW[k] = best;
      }
    }
  }

  const chosen: ScoredCase[] = [];
  let w = cap;
  let k = slots;
  for (let i = n; i >= 1; i -= 1) {
    if (dp[i][w][k] !== dp[i - 1][w][k]) {
      chosen.push(candidates[i - 1]);
      w -= weights[i - 1];
      k -= 1;
    }
  }
  return chosen;
}

export function optimizeMultipleSlates(
  cases: PatientCase[],
  date: Date,
  maxSlates: number
): SlateResult[] {
  const results: SlateResult[] = [];
  let remainingCases = [...cases];

  for (let i = 0; i < maxSlates; i += 1) {
    if (remainingCases.length === 0) break;
    const result = optimizeSlate(remainingCases, date);
    if (result.selected.length === 0) break;
    results.push(result);
    const selectedIds = new Set(result.selected.map((item) => item.caseId));
    remainingCases = remainingCases.filter((item) => !selectedIds.has(item.caseId));
  }

  if (results.length > 0) {
    const last = results[results.length - 1];
    last.remaining = scoreCases(remainingCases, date);
  }

  return results;
}

export function optimizeSlatesForDates(
  cases: PatientCase[],
  dates: Date[]
): SlateResult[] {
  const results: SlateResult[] = [];
  let remainingCases = [...cases];

  for (let i = 0; i < dates.length; i += 1) {
    if (remainingCases.length === 0) break;
    const date = dates[i];
    const eligibleCases = remainingCases.filter((item) =>
      isAvailableOnDate(item.unavailableUntil, date)
    );
    if (eligibleCases.length === 0) {
      continue;
    }
    const result = optimizeSlate(eligibleCases, date);
    if (result.selected.length === 0) break;
    results.push(result);
    const selectedIds = new Set(result.selected.map((item) => item.caseId));
    remainingCases = remainingCases.filter((item) => !selectedIds.has(item.caseId));
  }

  if (results.length > 0) {
    const last = results[results.length - 1];
    last.remaining = scoreCases(remainingCases, dates[results.length - 1]);
  }

  return results;
}
