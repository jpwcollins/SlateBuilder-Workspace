// The confirmation shown before a patient is placed on a slate by hand.
//
// Placing someone on a full day moves others. Most of those moves are routine,
// but some push a patient who ranks above the one being placed to a later day
// or off the slates entirely, often someone already overdue. Those are listed
// first, by name, with how overdue they are and their priority, so nobody
// agrees to them without seeing it. Everything else follows as "Other changes".

import { sortForWaitlist } from "./caseHelpers";
import { PriorityMode, ScoredCase } from "./types";

export type PlacementMove = {
  caseId: string;
  /** The date it was on, or null if it came from the waitlist. */
  fromDateISO: string | null;
  /** The date it moves to, or null if it goes back to the waitlist. */
  toDateISO: string | null;
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

const waitPhrase = (item: ScoredCase) =>
  item.timeToTargetDays < 0
    ? `${Math.abs(item.timeToTargetDays)} days overdue`
    : `${item.timeToTargetDays} days to target`;

/** True when this move puts the patient later than they were, or off the slates. */
export function isPushedLater(move: PlacementMove): boolean {
  if (move.fromDateISO === null) return false;
  if (move.toDateISO === null) return true;
  return move.toDateISO > move.fromDateISO;
}

export type PlacementWarning = {
  /** e.g. "Megan O'Connor (26w, priority 2.19)". */
  placedSummary: string;
  /** The target date, short, e.g. "Dec 18". */
  toLabel: string;
  /** Patients ranking above the one placed who are pushed later or off. */
  higherRanked: { caseId: string; label: string; wait: string; priority: string; toLabel: string }[];
  /** Every other move, one line each. */
  otherChanges: { caseId: string; text: string }[];
  /** The whole warning as plain text, for a browser confirm box. */
  message: string;
  higherRankedPushed: string[];
};

/**
 * The confirmation for placing `placed` on `toDateISO`, or null when the
 * placement moves nobody else. `cases` must include everyone in `moves`.
 */
export function describePlacement(input: {
  placed: ScoredCase;
  toDateISO: string;
  moves: PlacementMove[];
  cases: ScoredCase[];
  priorityMode: PriorityMode;
}): PlacementWarning | null {
  const { placed, toDateISO, priorityMode } = input;
  const byId = new Map(input.cases.map((c) => [c.caseId, c]));
  const moves = input.moves.filter((m) => m.caseId !== placed.caseId && byId.has(m.caseId));
  if (moves.length === 0) return null;

  const outranks = (other: ScoredCase) =>
    sortForWaitlist([placed, other], priorityMode)[0].caseId === other.caseId;
  const higher = moves.filter((m) => isPushedLater(m) && outranks(byId.get(m.caseId)!));
  const others = moves.filter((m) => !higher.includes(m));

  const where = (iso: string | null) => (iso ? shortDate(iso) : "back to the waitlist");
  const routineText = (m: PlacementMove) => {
    const item = byId.get(m.caseId)!;
    if (m.fromDateISO === null) return `${item.displayLabel}: from the waitlist → ${shortDate(m.toDateISO!)}`;
    return `${item.displayLabel}: ${shortDate(m.fromDateISO)} → ${where(m.toDateISO)}`;
  };
  const routine = (m: PlacementMove) => `• ${routineText(m)}`;
  const placedSummary = `${placed.displayLabel} (${placed.benchmarkWeeks}w, priority ${placed.priorityScore.toFixed(2)})`;

  const lines: string[] = [];
  if (higher.length > 0) {
    const n = higher.length;
    lines.push(
      `Placing ${placedSummary} ` +
        `on ${shortDate(toDateISO)} pushes ${n} higher-ranked ${n === 1 ? "patient" : "patients"} later:`,
    );
    higher.forEach((m) => {
      const item = byId.get(m.caseId)!;
      lines.push(
        `• ${item.displayLabel}, ${waitPhrase(item)}, priority ${item.priorityScore.toFixed(1)} → ${where(m.toDateISO)}`,
      );
    });
    if (others.length > 0) {
      lines.push("", "Other changes:", ...others.map(routine));
    }
    lines.push("", "A reason for placing them ahead is needed.");
  } else {
    lines.push(`Placing ${placed.displayLabel} on ${shortDate(toDateISO)} also changes:`, ...others.map(routine));
  }
  lines.push("", "Go ahead?");
  return {
    placedSummary,
    toLabel: shortDate(toDateISO),
    higherRanked: higher.map((m) => {
      const item = byId.get(m.caseId)!;
      return {
        caseId: m.caseId,
        label: item.displayLabel,
        wait: waitPhrase(item),
        priority: item.priorityScore.toFixed(1),
        toLabel: where(m.toDateISO),
      };
    }),
    otherChanges: others.map((m) => ({ caseId: m.caseId, text: routineText(m) })),
    message: lines.join("\n"),
    higherRankedPushed: higher.map((m) => m.caseId),
  };
}
