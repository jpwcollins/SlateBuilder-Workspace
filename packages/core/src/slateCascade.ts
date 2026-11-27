// Placing a patient by hand onto a slate that is already full.
//
// Rather than refusing the drop, the target slate makes room by moving out its
// lowest-priority cases. Each of those goes to the earliest date it can have:
// any slate, before or after, that already has room for it, or a later slate
// that can move out one of its own lower-priority cases, which then goes the
// same way.
// Whoever fits nowhere goes back to the waitlist as not yet slated.
//
// What is never moved:
//   * anything on a locked slate (a locked slate is skipped entirely);
//   * a case a person placed on its date by hand (`pinned`): that was a
//     decision, and the cascade only rearranges what the slate builder chose.
//
// Pushing a case out only ever happens on a later date, and only to cases
// ranked below the one coming in, so the cascade follows the priority order
// and always ends. Taking up free room, earlier or later, pushes nobody out.

import { isAvailableOnDate } from "./date";
import { caseFitsInSlate, sortForWaitlist } from "./caseHelpers";
import { PriorityMode, ScoredCase } from "./types";

export type CascadeSlate = {
  dateISO: string;
  blockMinutes: number;
  locked: boolean;
  cases: ScoredCase[];
};

export type CascadeMove = {
  caseId: string;
  displayLabel: string;
  fromDateISO: string;
  /** The later slate it moved to, or null when it went back to the waitlist. */
  toDateISO: string | null;
};

export type CascadePlan =
  | { ok: true; slates: ScoredCase[][]; moves: CascadeMove[] }
  | { ok: false; reason: "pinned" | "too_long" };

const fits = (cases: ScoredCase[], candidate: ScoredCase, blockMinutes: number) =>
  caseFitsInSlate(
    cases.reduce((sum, c) => sum + c.estimatedDurationMin, 0),
    cases.length,
    candidate.estimatedDurationMin,
    blockMinutes,
  );

const availableOn = (item: ScoredCase, dateISO: string) =>
  !dateISO || isAvailableOnDate(item.unavailableUntil, new Date(`${dateISO}T00:00:00`));

/**
 * Makes room for `incoming` on `cases` by taking out movable cases, lowest
 * priority first, then putting back any of those that still fit (a long case
 * leaving can free room for a short one taken out before it). Only cases for
 * which `movable` is true are considered. Returns null if no amount of taking
 * out makes it fit.
 */
function makeRoom(
  cases: ScoredCase[],
  incoming: ScoredCase,
  blockMinutes: number,
  movable: (item: ScoredCase) => boolean,
  priorityMode: PriorityMode,
): { kept: ScoredCase[]; out: ScoredCase[] } | null {
  const ranked = sortForWaitlist(cases, priorityMode);
  const lowestFirst = [...ranked].reverse().filter(movable);
  let kept = [...cases];
  const out: ScoredCase[] = [];
  for (const candidate of lowestFirst) {
    if (fits(kept, incoming, blockMinutes)) break;
    kept = kept.filter((c) => c.caseId !== candidate.caseId);
    out.push(candidate);
  }
  if (!fits(kept, incoming, blockMinutes)) return null;
  kept = [...kept, incoming];
  // Highest priority first, so the most deserving get their place back.
  const stillOut: ScoredCase[] = [];
  for (const candidate of sortForWaitlist(out, priorityMode)) {
    if (fits(kept, candidate, blockMinutes)) kept.push(candidate);
    else stillOut.push(candidate);
  }
  return { kept, out: stillOut };
}

/**
 * Plans dropping `dropped` onto slate `targetIndex`. `slates` are in date
 * order. The dropped case is taken off whichever slate held it first. The
 * caller checks the target's lock and the dropped case's availability; this
 * decides only how the room is found.
 */
export function planDropWithCascade(input: {
  slates: CascadeSlate[];
  dropped: ScoredCase;
  targetIndex: number;
  /** Case ids a person placed on their current date by hand. */
  pinned: Record<string, boolean>;
  priorityMode: PriorityMode;
}): CascadePlan {
  const { dropped, targetIndex, pinned, priorityMode } = input;
  const slates = input.slates.map((s) => ({
    ...s,
    cases: s.cases.filter((c) => c.caseId !== dropped.caseId),
  }));
  const target = slates[targetIndex];
  if (!target) return { ok: false, reason: "too_long" };

  if (fits(target.cases, dropped, target.blockMinutes)) {
    target.cases = [...target.cases, dropped];
    return { ok: true, slates: slates.map((s) => s.cases), moves: [] };
  }

  const room = makeRoom(
    target.cases,
    dropped,
    target.blockMinutes,
    (c) => !pinned[c.caseId],
    priorityMode,
  );
  if (!room) {
    // Would it fit if the hand-placed cases could move too? Then those are
    // what is in the way; otherwise the case is simply too long for the day.
    const ignoringPins = makeRoom(target.cases, dropped, target.blockMinutes, () => true, priorityMode);
    return { ok: false, reason: ignoringPins ? "pinned" : "too_long" };
  }
  target.cases = room.kept;

  const moves = new Map<string, CascadeMove>();
  const queue: { item: ScoredCase; from: number }[] = room.out.map((item) => ({
    item,
    from: targetIndex,
  }));
  const originalDate = (caseId: string, fallback: string) =>
    moves.get(caseId)?.fromDateISO ?? fallback;

  while (queue.length > 0) {
    // Highest priority first, so a better-ranked case gets first claim on the
    // next slate's room.
    const nextId = sortForWaitlist(
      queue.map((q) => q.item),
      priorityMode,
    )[0].caseId;
    const { item, from } = queue.splice(
      queue.findIndex((q) => q.item.caseId === nextId),
      1,
    )[0];
    const fromDateISO = originalDate(item.caseId, slates[from].dateISO);
    let placedAt: number | null = null;
    const canTake = (j: number) =>
      j !== from && !slates[j].locked && availableOn(item, slates[j].dateISO);

    // The earliest date it can have. Any slate with free room will do; a
    // later slate can also make room by moving out its own lower-ranked cases
    // (never an earlier one, which is what keeps the cascade finite).
    for (let j = 0; j < slates.length && placedAt === null; j++) {
      if (!canTake(j)) continue;
      const slate = slates[j];
      if (fits(slate.cases, item, slate.blockMinutes)) {
        slate.cases = [...slate.cases, item];
        placedAt = j;
        break;
      }
      if (j < from) continue;
      // Only push out cases that rank below this one and were not placed by hand.
      const ranked = sortForWaitlist([...slate.cases, item], priorityMode);
      const rankOf = (c: ScoredCase) => ranked.findIndex((x) => x.caseId === c.caseId);
      const itemRank = rankOf(item);
      const made = makeRoom(
        slate.cases,
        item,
        slate.blockMinutes,
        (c) => !pinned[c.caseId] && rankOf(c) > itemRank,
        priorityMode,
      );
      if (made) {
        slate.cases = made.kept;
        for (const out of made.out) queue.push({ item: out, from: j });
        placedAt = j;
      }
    }

    // A case that ends up back where it started has not moved.
    if (placedAt !== null && slates[placedAt].dateISO === fromDateISO) {
      moves.delete(item.caseId);
      continue;
    }
    moves.set(item.caseId, {
      caseId: item.caseId,
      displayLabel: item.displayLabel,
      fromDateISO,
      toDateISO: placedAt === null ? null : slates[placedAt].dateISO,
    });
  }

  return { ok: true, slates: slates.map((s) => s.cases), moves: [...moves.values()] };
}
