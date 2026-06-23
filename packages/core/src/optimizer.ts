import { getBlockMinutes, isAvailableOnDate } from "./date";
import { PatientCase, ScoredCase, SlateResult } from "./types";

const urgencyWeightMap: Record<number, number> = {
  2: 5,
  4: 4,
  6: 3,
  12: 2,
  26: 1,
};

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
    const riskScore = urgencyWeight * (1 + overdueDays / 14);
    return { ...item, urgencyWeight, overdueDays, riskScore, valueScore: 0 };
  });

  const totalRisk = scoredBase.reduce((sum, item) => sum + item.riskScore, 0);
  const utilizationWeight = totalRisk > 0 ? totalRisk / blockMinutes : 1 / blockMinutes;

  return scoredBase.map((item) => ({
    ...item,
    valueScore: item.riskScore + utilizationWeight * item.estimatedDurationMin,
  }));
}

export function optimizeSlate(cases: PatientCase[], date: Date): SlateResult {
  const blockMinutes = getBlockMinutes(date);
  const scored = scoreCases(cases, date);

  const durations = scored.map((item) => Math.round(item.estimatedDurationMin));
  const values = scored.map((item) => item.valueScore);
  const n = scored.length;

  // 0/1 knapsack with a full 2-D table so the optimum can be reconstructed
  // consistently. dp[i][w] = best total value using the first i cases within w
  // minutes of block time. (A 1-D table with per-cell "keep" flags cannot be
  // back-tracked reliably because cells are mutated across items.)
  const dp: Float64Array[] = Array.from(
    { length: n + 1 },
    () => new Float64Array(blockMinutes + 1)
  );

  for (let i = 1; i <= n; i += 1) {
    const weight = durations[i - 1];
    const value = values[i - 1];
    const prev = dp[i - 1];
    const curr = dp[i];
    for (let w = 0; w <= blockMinutes; w += 1) {
      let best = prev[w];
      if (weight <= w) {
        const candidate = prev[w - weight] + value;
        if (candidate > best) best = candidate;
      }
      curr[w] = best;
    }
  }

  // Reconstruct: case i-1 is included at capacity w iff including it produced a
  // strictly better value than excluding it.
  const selectedIndexes: number[] = [];
  let w = blockMinutes;
  for (let i = n; i >= 1; i -= 1) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selectedIndexes.push(i - 1);
      w -= durations[i - 1];
    }
  }

  const selectedSet = new Set(selectedIndexes);
  const selected = scored
    .filter((_, idx) => selectedSet.has(idx))
    .sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return a.timeToTargetDays - b.timeToTargetDays;
    });
  const remaining = scored.filter((_, idx) => !selectedSet.has(idx));

  const totalMinutes = selected.reduce((sum, item) => sum + item.estimatedDurationMin, 0);
  const totalRiskScore = selected.reduce((sum, item) => sum + item.riskScore, 0);
  const utilizationPct = blockMinutes > 0 ? (totalMinutes / blockMinutes) * 100 : 0;

  const totalRiskAll = scored.reduce((sum, item) => sum + item.riskScore, 0);
  const utilizationWeight = totalRiskAll > 0 ? totalRiskAll / blockMinutes : 1 / blockMinutes;

  return {
    blockMinutes,
    totalMinutes,
    utilizationPct,
    totalRiskScore,
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
