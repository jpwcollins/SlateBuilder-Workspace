// Optimize Utilization: fit more OR time into the unlocked slates without
// reshuffling them for nothing.
//
// It starts from the slates as they are and only ever makes a change that
// adds OR time:
//
//   1. Fill. Waiting patients, highest priority first, each take the earliest
//      unlocked slate with room for them.
//   2. Swap. A waiting patient may replace one or more slated patients when
//      the slate ends up holding more OR time, and only if every patient going
//      out ranks below the one coming in. Whoever comes off goes back to the
//      waitlist and can be placed again by the next fill.
//
// Fill and swap repeat until nothing more can be gained. A slate that is
// already full, or a set of slates no swap can improve, is left exactly as it
// was.
//
// What is never moved:
//   * anything on a locked slate (a locked slate is skipped entirely);
//   * a case a person placed on its date by hand (`pinned`);
//   * an overdue case, in favour of one that is not yet overdue.

import { isAvailableOnDate } from "./date";
import { caseFitsInSlate, sortForWaitlist } from "./caseHelpers";
import { TURNAROUND_MINUTES } from "./optimizer";
import { PriorityMode, ScoredCase } from "./types";

export type OptimizeSlate = {
  dateISO: string;
  blockMinutes: number;
  locked: boolean;
  cases: ScoredCase[];
};

export type OptimizeResult = {
  /** Cases on each slate after optimizing, in the same order as the input. */
  slates: ScoredCase[][];
  /** True when at least one slate changed. */
  changed: boolean;
};

const surgicalOf = (cases: ScoredCase[]) =>
  cases.reduce((sum, c) => sum + c.estimatedDurationMin, 0);

/** Minutes of the block in use: cases plus the turnaround between them. */
export const occupiedMinutes = (cases: ScoredCase[]) =>
  surgicalOf(cases) + TURNAROUND_MINUTES * Math.max(0, cases.length - 1);

const fits = (cases: ScoredCase[], candidate: ScoredCase, blockMinutes: number) =>
  caseFitsInSlate(surgicalOf(cases), cases.length, candidate.estimatedDurationMin, blockMinutes);

const availableOn = (item: ScoredCase, dateISO: string) =>
  !dateISO || isAvailableOnDate(item.unavailableUntil, new Date(`${dateISO}T00:00:00`));

const isOverdue = (item: ScoredCase) => item.timeToTargetDays < 0;

export function planOptimizeUtilization(input: {
  slates: OptimizeSlate[];
  /** Patients eligible for a slate and not on one now. */
  waiting: ScoredCase[];
  /** Case ids a person placed on their current date by hand. */
  pinned: Record<string, boolean>;
  priorityMode: PriorityMode;
}): OptimizeResult {
  const { pinned, priorityMode } = input;
  const slates = input.slates.map((s) => ({ ...s, cases: [...s.cases] }));
  const onSlate = new Set(slates.flatMap((s) => s.cases.map((c) => c.caseId)));
  let waiting = sortForWaitlist(
    input.waiting.filter((c) => !onSlate.has(c.caseId)),
    priorityMode,
  );
  let changed = false;

  const open = (j: number, item: ScoredCase) =>
    !slates[j].locked && availableOn(item, slates[j].dateISO);

  const fill = () => {
    const stillWaiting: ScoredCase[] = [];
    for (const item of waiting) {
      const j = slates.findIndex((s, k) => open(k, item) && fits(s.cases, item, s.blockMinutes));
      if (j === -1) {
        stillWaiting.push(item);
        continue;
      }
      slates[j].cases.push(item);
      changed = true;
    }
    waiting = stillWaiting;
  };

  // The best set of cases to take off slate `j` for `item`: only ones ranked
  // below it, not pinned, and not overdue unless `item` is too. Of the sets
  // that make room and add OR time, the one that adds the most; ties go to
  // taking off the lowest-ranked. Slates hold at most seven cases, so trying
  // every set is cheap.
  const bestSwap = (j: number, item: ScoredCase): ScoredCase[] | null => {
    const slate = slates[j];
    const ranked = sortForWaitlist([...slate.cases, item], priorityMode);
    const rankOf = (c: ScoredCase) => ranked.findIndex((x) => x.caseId === c.caseId);
    const itemRank = rankOf(item);
    const movable = slate.cases.filter(
      (c) =>
        !pinned[c.caseId] &&
        rankOf(c) > itemRank &&
        (isOverdue(item) || !isOverdue(c)),
    );
    const before = occupiedMinutes(slate.cases);
    let best: { out: ScoredCase[]; gain: number; rankSum: number } | null = null;
    for (let mask = 1; mask < 1 << movable.length; mask++) {
      const out = movable.filter((_, b) => mask & (1 << b));
      const kept = slate.cases.filter((c) => !out.includes(c));
      if (!fits(kept, item, slate.blockMinutes)) continue;
      const gain = occupiedMinutes([...kept, item]) - before;
      if (gain <= 0) continue;
      const rankSum = out.reduce((sum, c) => sum + rankOf(c), 0);
      if (
        !best ||
        gain > best.gain ||
        (gain === best.gain && out.length < best.out.length) ||
        (gain === best.gain && out.length === best.out.length && rankSum > best.rankSum)
      ) {
        best = { out, gain, rankSum };
      }
    }
    return best ? best.out : null;
  };

  // One swap at a time: the highest-priority waiting patient that can improve
  // a slate takes the earliest slate it improves. Each swap adds OR time to
  // one slate and leaves the others alone, so total OR time only goes up and
  // the loop ends.
  const swapOnce = (): boolean => {
    for (const item of waiting) {
      for (let j = 0; j < slates.length; j++) {
        if (!open(j, item)) continue;
        const out = bestSwap(j, item);
        if (!out) continue;
        slates[j].cases = [...slates[j].cases.filter((c) => !out.includes(c)), item];
        waiting = sortForWaitlist(
          [...waiting.filter((c) => c.caseId !== item.caseId), ...out],
          priorityMode,
        );
        changed = true;
        return true;
      }
    }
    return false;
  };

  fill();
  while (swapOnce()) fill();

  return { slates: slates.map((s) => s.cases), changed };
}
