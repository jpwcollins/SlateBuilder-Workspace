import { getBlockMinutes, isAvailableOnDate } from "./date";
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

export function scoreCases(cases: PatientCase[], date: Date): ScoredCase[] {
  const blockMinutes = getBlockMinutes(date);
  const scoredBase = cases.map((item) => {
    const urgencyWeight = urgencyWeightMap[item.benchmarkWeeks] ?? 1;
    const overdueDays = Math.max(0, -item.timeToTargetDays);
    const priorityScore = urgencyWeight * (1 + overdueDays / 14);
    return { ...item, urgencyWeight, overdueDays, priorityScore, valueScore: 0 };
  });

  const totalPriority = scoredBase.reduce((sum, item) => sum + item.priorityScore, 0);
  const utilizationWeight = totalPriority > 0 ? totalPriority / blockMinutes : 1 / blockMinutes;

  return scoredBase.map((item) => ({
    ...item,
    valueScore: item.priorityScore + utilizationWeight * item.estimatedDurationMin,
  }));
}

export function optimizeSlate(cases: PatientCase[], date: Date): SlateResult {
  const blockMinutes = getBlockMinutes(date);
  const scored = scoreCases(cases, date);

  const values = scored.map((item) => item.valueScore);
  const n = scored.length;

  // Turnaround follows every case except the last. Packing each case with
  // weight = duration + TAT into a capacity of (block + TAT) exactly models
  // that: a slate of k cases consumes sum(durations) + TAT*(k-1) <= block.
  const weights = scored.map(
    (item) => Math.round(item.estimatedDurationMin) + TURNAROUND_MINUTES
  );
  const capacity = blockMinutes + TURNAROUND_MINUTES;
  const maxCases = MAX_CASES_PER_SLATE;

  // 0/1 knapsack with two constraints — capacity (minutes) and cardinality
  // (<= 7 cases). dp[i][w][k] = best value from the first i cases within w
  // minutes using at most k cases. The full table makes reconstruction exact.
  const dp: Float64Array[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: capacity + 1 }, () => new Float64Array(maxCases + 1))
  );

  for (let i = 1; i <= n; i += 1) {
    const weight = weights[i - 1];
    const value = values[i - 1];
    const prev = dp[i - 1];
    const curr = dp[i];
    for (let w = 0; w <= capacity; w += 1) {
      const prevW = prev[w];
      const prevFit = weight <= w ? prev[w - weight] : null;
      const currW = curr[w];
      for (let k = 0; k <= maxCases; k += 1) {
        let best = prevW[k];
        if (prevFit && k >= 1) {
          const candidate = prevFit[k - 1] + value;
          if (candidate > best) best = candidate;
        }
        currW[k] = best;
      }
    }
  }

  // Reconstruct: case i-1 is included iff including it (consuming one case slot)
  // produced a strictly better value than excluding it.
  const selectedIndexes: number[] = [];
  let w = capacity;
  let k = maxCases;
  for (let i = n; i >= 1; i -= 1) {
    if (dp[i][w][k] !== dp[i - 1][w][k]) {
      selectedIndexes.push(i - 1);
      w -= weights[i - 1];
      k -= 1;
    }
  }

  const selectedSet = new Set(selectedIndexes);
  const selected = scored
    .filter((_, idx) => selectedSet.has(idx))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return a.timeToTargetDays - b.timeToTargetDays;
    });
  const remaining = scored.filter((_, idx) => !selectedSet.has(idx));

  const totalMinutes = selected.reduce((sum, item) => sum + item.estimatedDurationMin, 0);
  const turnaroundMinutes = TURNAROUND_MINUTES * Math.max(0, selected.length - 1);
  const totalPriorityScore = selected.reduce((sum, item) => sum + item.priorityScore, 0);
  const occupiedMinutes = totalMinutes + turnaroundMinutes;
  const utilizationPct = blockMinutes > 0 ? (occupiedMinutes / blockMinutes) * 100 : 0;

  const totalPriorityAll = scored.reduce((sum, item) => sum + item.priorityScore, 0);
  const utilizationWeight = totalPriorityAll > 0 ? totalPriorityAll / blockMinutes : 1 / blockMinutes;

  return {
    blockMinutes,
    totalMinutes,
    turnaroundMinutes,
    utilizationPct,
    totalPriorityScore,
    utilizationWeight,
    selected,
    remaining,
  };
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
