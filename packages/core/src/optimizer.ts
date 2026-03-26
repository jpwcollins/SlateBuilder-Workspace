import { getBlockMinutes, isAvailableOnDate } from "./date";
import { PatientCase, ScoredCase, SlateResult } from "./types";

const urgencyWeightMap: Record<number, number> = {
  2: 5,
  4: 4,
  6: 3,
  12: 2,
  26: 1,
};

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

  const dp: number[] = Array(blockMinutes + 1).fill(0);
  const keep: boolean[][] = Array.from({ length: scored.length }, () =>
    Array(blockMinutes + 1).fill(false)
  );

  for (let i = 0; i < scored.length; i += 1) {
    const weight = durations[i];
    const value = values[i];
    for (let w = blockMinutes; w >= weight; w -= 1) {
      const candidate = dp[w - weight] + value;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        keep[i][w] = true;
      }
    }
  }

  let w = blockMinutes;
  const selectedIndexes: number[] = [];
  for (let i = scored.length - 1; i >= 0; i -= 1) {
    if (keep[i][w]) {
      selectedIndexes.push(i);
      w -= durations[i];
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
