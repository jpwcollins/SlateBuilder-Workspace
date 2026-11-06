// Whether each case on a slate was booked in priority (first-in-first-out)
// order, and if not, why.
//
// The rule that keeps this readable: a mark describes its own case and nothing
// else. Something done to one patient never changes the mark on another.
//
// "In order" is judged against the same ranking the Priority Waitlist shows:
// a slated case is out of order when somebody who ranks ahead of it, and who
// was there to be booked for that OR date, is still waiting or is booked for a
// later date. Within one benchmark class that ranking is strict
// first-in-first-out; across classes it follows urgency.
//
// Four things are deliberately NOT treated as out of order:
//   * passing a patient who is unavailable on that date — they could not have
//     been booked, so nobody jumped them;
//   * passing a patient a person put off — held back from the suggested slates,
//     or dragged to a later date. Whatever the reason, or the lack of one, that
//     is a fact about the patient who was put off, not about everyone behind
//     them. It is reported separately (findUnexplainedPutOffs) so that a
//     hold-back nobody has explained stays visible without repainting a slate
//     of cases that did nothing;
//   * passing a patient who has been taken off the waitlist altogether (the
//     caller leaves them out of `candidates`);
//   * the running order within the day. This is about which date a patient
//     gets, not where they sit on it.
//
// When a case is out of order the cause is one of:
//   * "optimization" — nobody placed it there by hand; the slate builder chose
//     this mix of cases to fit the block;
//   * "clinical"     — a person dragged it onto this date, and a recorded
//     reason or a clinical flag on it accounts for that;
//   * "unexplained"  — a person dragged it onto this date and nothing does.

import { isAvailableOnDate, normalizeDateOnly } from "./date";
import { priorityScoreOf } from "./optimizer";
import { clinicalFlagDefinitions, PatientCase, PriorityMode } from "./types";

export type BookingOrderStatus = "fifo" | "clinical" | "optimization" | "unexplained";

/** Display text for each status. `label` is the full wording used in exports. */
export const BOOKING_ORDER_TEXT: Record<BookingOrderStatus, { label: string; short: string }> = {
  fifo: { label: "FIFO order", short: "FIFO" },
  clinical: { label: "Out of order: clinical exception", short: "Clinical" },
  optimization: { label: "Out of order: slate optimization", short: "Optimization" },
  unexplained: { label: "Out of order: no reason recorded", short: "No reason" },
};

/** Most serious first; used wherever the statuses are listed or summarized. */
export const BOOKING_ORDER_STATUSES: BookingOrderStatus[] = [
  "unexplained",
  "clinical",
  "optimization",
  "fifo",
];

/**
 * The reasons a person can record for booking a patient out of order. A fixed
 * list rather than free text so that what reaches an exported slate can never
 * carry identifying detail.
 */
export const ORDER_REASONS = [
  { code: "clinical_urgency", label: "Clinical urgency" },
  { code: "medical_requirement", label: "Medical or anaesthetic requirement" },
  { code: "resources", label: "Equipment or staffing" },
  { code: "patient_circumstances", label: "Patient circumstances" },
  { code: "patient_deferred", label: "Patient deferred or declined the date" },
  { code: "other_clinical", label: "Other clinical reason" },
] as const;

export type OrderReasonCode = (typeof ORDER_REASONS)[number]["code"];

/**
 * A recorded reason. `note` is optional free text for the office's own use: it
 * is shown on screen and kept in the notes file, and is never exported.
 */
export type OrderReason = { code: OrderReasonCode; note?: string };

export const ORDER_REASON_NOTE_MAX = 200;

export function orderReasonLabel(code: OrderReasonCode): string {
  return ORDER_REASONS.find((reason) => reason.code === code)?.label ?? code;
}

/**
 * Accepts a reason read from a notes file, or rejects it. A file written by a
 * different build may carry a code this one does not know; that is dropped
 * rather than shown as a blank reason.
 */
export function parseOrderReason(value: unknown): OrderReason | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as { code?: unknown; note?: unknown };
  const known = ORDER_REASONS.find((reason) => reason.code === raw.code);
  if (!known) return undefined;
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, ORDER_REASON_NOTE_MAX) : "";
  return note ? { code: known.code, note } : { code: known.code };
}

/**
 * Whether `a` ranks strictly ahead of `b` under the given priority rule — the
 * same ordering sortForWaitlist produces. Patients who tie are not ahead of
 * one another, so booking either first is in order.
 */
export function ranksAhead(a: PatientCase, b: PatientCase, priorityMode: PriorityMode): boolean {
  if (priorityMode === "ttt") return a.timeToTargetDays < b.timeToTargetDays;
  const diff = priorityScoreOf(a) - priorityScoreOf(b);
  if (Math.abs(diff) > 1e-9) return diff > 0;
  return a.timeToTargetDays < b.timeToTargetDays;
}

export type BookingOrderInput = {
  /** The slates as they currently stand. */
  slates: { dateISO: string; cases: PatientCase[] }[];
  /**
   * Everyone who is still on the waitlist, slated or not, with the office's
   * current flags and unavailable dates applied. Leave out anyone removed from
   * the waitlist entirely.
   */
  candidates: PatientCase[];
  priorityMode: PriorityMode;
  /** caseId -> the slate date a person dragged that patient onto. */
  manualPlacements?: Record<string, string>;
  /** Patients a person has taken off the suggested slates. */
  heldBack?: Record<string, boolean>;
  /** Recorded reasons, by caseId. */
  reasons?: Record<string, OrderReason>;
};

export type BookingOrder = {
  status: BookingOrderStatus;
  /** Higher-ranked patients who could have had this date and were passed. */
  passedCaseIds: string[];
  /** What accounts for it, as a short label. Empty when in order. */
  reasons: string[];
  /**
   * For "unexplained": this case's own id, as the one a reason needs recording
   * against. Empty otherwise. A list so callers can gather them uniformly.
   */
  needsReasonCaseIds: string[];
  /** One sentence for tooltips and exports. Carries no patient identifiers. */
  detail: string;
};

const OPTIMIZATION_REASON = "Best use of OR time";
const UNEXPLAINED_REASON = "No reason recorded";

function activeFlagLabels(item: PatientCase): string[] {
  return clinicalFlagDefinitions
    .filter((flag) => item.flags?.[flag.key])
    .map((flag) => flag.label);
}

/**
 * What accounts for a person having moved this patient: the reason they
 * recorded, or failing that a clinical flag on the patient. Null if neither.
 */
function explanationFor(item: PatientCase, reasons: Record<string, OrderReason>): string | null {
  const recorded = reasons[item.caseId];
  if (recorded) return orderReasonLabel(recorded.code);
  const flags = activeFlagLabels(item);
  if (flags.length > 0) return `Clinical flag: ${flags.join(", ")}`;
  return null;
}

function passedPhrase(count: number): string {
  return `Booked ahead of ${count} higher-ranked patient${count === 1 ? "" : "s"}`;
}

/** Shared reading of the slates: who is booked when, and who was moved by hand. */
function readSlates(input: BookingOrderInput) {
  const manual = input.manualPlacements ?? {};
  const heldBack = input.heldBack ?? {};

  const slates = input.slates.map((slate) => {
    const dateISO = normalizeDateOnly(slate.dateISO) ?? "";
    return {
      dateISO,
      date: dateISO ? new Date(`${dateISO}T00:00:00`) : null,
      cases: slate.cases,
    };
  });

  // The date each slated patient is booked for.
  const bookedOn = new Map<string, string>();
  slates.forEach((slate) => {
    slate.cases.forEach((item) => {
      if (!bookedOn.has(item.caseId)) bookedOn.set(item.caseId, slate.dateISO);
    });
  });

  const manuallyPlacedOn = (caseId: string): string | undefined =>
    manual[caseId] === undefined ? undefined : normalizeDateOnly(manual[caseId]) ?? "";

  /** Not already booked on or before this date, and available for it. */
  const thereToBeBooked = (other: PatientCase, dateISO: string, date: Date | null): boolean => {
    const otherDate = bookedOn.get(other.caseId);
    if (otherDate !== undefined && otherDate <= dateISO) return false;
    return date ? isAvailableOnDate(other.unavailableUntil, date) : true;
  };

  /**
   * Whether a person put this patient off past the given date: held back from
   * the suggested slates, or dragged onto a later one.
   */
  const putOffPast = (other: PatientCase, dateISO: string): PutOffKind | null => {
    const otherDate = bookedOn.get(other.caseId);
    if (otherDate === undefined) return heldBack[other.caseId] ? "held_back" : null;
    if (otherDate > dateISO && manuallyPlacedOn(other.caseId) === otherDate) return "moved_later";
    return null;
  };

  return { slates, manuallyPlacedOn, thereToBeBooked, putOffPast };
}

/**
 * Classifies every slated case. The result is keyed by caseId and has an entry
 * for each case on any slate.
 */
export function classifyBookingOrder(input: BookingOrderInput): Record<string, BookingOrder> {
  const { candidates, priorityMode } = input;
  const reasons = input.reasons ?? {};
  const { slates, manuallyPlacedOn, thereToBeBooked, putOffPast } = readSlates(input);

  const out: Record<string, BookingOrder> = {};

  slates.forEach(({ dateISO, date, cases }) => {
    // Everyone who was there to be booked for this date and was not. Anyone a
    // person put off is left out: that is their exception, not this slate's.
    // Computed once per slate; each case then picks out those ranked ahead.
    const overlooked = candidates.filter(
      (other) => thereToBeBooked(other, dateISO, date) && putOffPast(other, dateISO) === null
    );

    cases.forEach((item) => {
      if (out[item.caseId]) return;
      const passed = overlooked.filter(
        (other) => other.caseId !== item.caseId && ranksAhead(other, item, priorityMode)
      );

      if (passed.length === 0) {
        out[item.caseId] = {
          status: "fifo",
          passedCaseIds: [],
          reasons: [],
          needsReasonCaseIds: [],
          detail: "Booked in priority order.",
        };
        return;
      }

      const passedCaseIds = passed.map((other) => other.caseId);

      if (manuallyPlacedOn(item.caseId) !== dateISO) {
        out[item.caseId] = {
          status: "optimization",
          passedCaseIds,
          reasons: [OPTIMIZATION_REASON],
          needsReasonCaseIds: [],
          detail: `${passedPhrase(passed.length)} to make best use of the OR time.`,
        };
        return;
      }

      const explanation = explanationFor(item, reasons);
      if (explanation === null) {
        out[item.caseId] = {
          status: "unexplained",
          passedCaseIds,
          reasons: [UNEXPLAINED_REASON],
          needsReasonCaseIds: [item.caseId],
          detail: `${passedPhrase(passed.length)} after being moved onto this slate by hand, with no reason recorded.`,
        };
        return;
      }

      out[item.caseId] = {
        status: "clinical",
        passedCaseIds,
        reasons: [explanation],
        needsReasonCaseIds: [],
        detail: `${passedPhrase(passed.length)}. Reason: ${explanation}.`,
      };
    });
  });

  return out;
}

export type PutOffKind = "held_back" | "moved_later";

/** A patient a person put off, with nothing recorded to account for it. */
export type UnexplainedPutOff = {
  caseId: string;
  kind: PutOffKind;
  /** The slates on which at least one lower-ranked case is booked instead. */
  slateDates: string[];
};

/**
 * Patients a person held back, or dragged to a later slate, who rank ahead of
 * somebody booked in their place and have neither a recorded reason nor a
 * clinical flag.
 *
 * This is the other half of classifyBookingOrder. A put-off patient does not
 * change the marks on the cases behind them, so without this an unexplained
 * hold-back would leave no trace on a slate at all. Reporting it as its own
 * short list keeps it visible — on screen, and as one line on the export —
 * while pointing at the patient it is actually about.
 *
 * A patient put off without consequence (nobody lower-ranked is booked on a
 * date they could have had) is not listed: there is nothing to account for.
 */
export function findUnexplainedPutOffs(input: BookingOrderInput): UnexplainedPutOff[] {
  const { candidates, priorityMode } = input;
  const reasons = input.reasons ?? {};
  const { slates, thereToBeBooked, putOffPast } = readSlates(input);

  const out: UnexplainedPutOff[] = [];
  candidates.forEach((other) => {
    if (explanationFor(other, reasons) !== null) return;
    let kind: PutOffKind | null = null;
    const slateDates: string[] = [];
    for (const { dateISO, date, cases } of slates) {
      const kindHere = putOffPast(other, dateISO);
      if (kindHere === null || !thereToBeBooked(other, dateISO, date)) continue;
      const bookedInstead = cases.some(
        (item) => item.caseId !== other.caseId && ranksAhead(other, item, priorityMode)
      );
      if (!bookedInstead) continue;
      kind = kindHere;
      if (!slateDates.includes(dateISO)) slateDates.push(dateISO);
    }
    if (kind !== null) out.push({ caseId: other.caseId, kind, slateDates });
  });
  return out;
}

/** The line printed on a slate when someone ahead of it was put off unexplained. */
export function unexplainedPutOffNote(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? "1 higher-ranked patient held back, no reason recorded"
    : `${count} higher-ranked patients held back, no reason recorded`;
}

/** How many cases fall under each status, for a slate's summary line. */
export function countBookingOrder(
  caseIds: string[],
  order: Record<string, BookingOrder>
): Record<BookingOrderStatus, number> {
  const counts: Record<BookingOrderStatus, number> = {
    fifo: 0,
    clinical: 0,
    optimization: 0,
    unexplained: 0,
  };
  caseIds.forEach((caseId) => {
    const entry = order[caseId];
    if (entry) counts[entry.status] += 1;
  });
  return counts;
}
