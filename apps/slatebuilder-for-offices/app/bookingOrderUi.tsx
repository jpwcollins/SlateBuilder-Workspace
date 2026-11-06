"use client";

// The booking-order indicator: whether a slated case was booked in priority
// (first-in-first-out) order and, if not, why. The rules live in
// @slatebuilder/core (bookingOrder.ts); this file is only how they look.
//
// Every status pairs its icon and colour with a word. Slates get printed, often
// in black and white, where green, blue and red are the same grey and the two
// blue statuses differ only by shape — so the word is what carries the meaning
// and the colour is a convenience on top of it.

import {
  BookingOrder,
  BookingOrderStatus,
  BOOKING_ORDER_STATUSES,
  BOOKING_ORDER_TEXT,
  ORDER_REASON_NOTE_MAX,
  ORDER_REASONS,
  OrderReason,
  OrderReasonCode,
} from "@slatebuilder/core";

const STATUS_CLASSES: Record<BookingOrderStatus, string> = {
  fifo: "bg-emerald-100 text-emerald-800",
  clinical: "bg-sky-100 text-sky-800",
  optimization: "bg-sky-100 text-sky-800",
  unexplained: "bg-rose-100 text-rose-700",
};

const STATUS_MEANING: Record<BookingOrderStatus, string> = {
  fifo: "Booked in priority order.",
  clinical:
    "Moved onto this slate by hand, ahead of others, with a recorded reason or a clinical flag that accounts for it.",
  optimization: "Out of order because this mix of cases makes best use of the OR time.",
  unexplained: "Moved onto this slate by hand, ahead of others, with no reason recorded.",
};

function StatusIcon({ status }: { status: BookingOrderStatus }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "shrink-0",
  };
  if (status === "fifo") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.5l2.8 2.8L16 9.5" />
      </svg>
    );
  }
  if (status === "clinical") {
    // A stethoscope: earpiece tubes, the loop, and the chest piece.
    return (
      <svg {...common}>
        <path d="M5 3v6a4 4 0 0 0 8 0V3" />
        <path d="M9 13v2.5a5 5 0 0 0 10 0V14" />
        <circle cx="19" cy="11.5" r="2.2" />
      </svg>
    );
  }
  if (status === "optimization") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.2 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.2" />
      <path d="M12 16.3v.2" />
    </svg>
  );
}

/** The at-a-glance pill shown on a slate card. Hover for the full sentence. */
export function BookingOrderBadge({ order }: { order: BookingOrder | undefined }) {
  if (!order) return null;
  const text = BOOKING_ORDER_TEXT[order.status];
  return (
    <span
      title={order.detail}
      aria-label={`${text.label}. ${order.detail}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${STATUS_CLASSES[order.status]}`}
    >
      <StatusIcon status={order.status} />
      {text.short}
    </span>
  );
}

/**
 * What the indicators mean, for the top of the slates section. `omit` leaves
 * out a status the app showing the legend can never produce.
 */
export function BookingOrderLegend({ omit = [] }: { omit?: BookingOrderStatus[] }) {
  const inReadingOrder = [...BOOKING_ORDER_STATUSES]
    .reverse()
    .filter((status) => !omit.includes(status));
  return (
    <ul className="flex flex-col gap-1.5 text-xs text-sand-700">
      {inReadingOrder.map((status) => (
        <li key={status} className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${STATUS_CLASSES[status]}`}
          >
            <StatusIcon status={status} />
            {BOOKING_ORDER_TEXT[status].short}
          </span>
          <span>{STATUS_MEANING[status]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Compact per-slate tally, e.g. "5 FIFO · 1 Optimization · 1 No reason". */
export function BookingOrderTally({ counts }: { counts: Record<BookingOrderStatus, number> }) {
  const parts = [...BOOKING_ORDER_STATUSES]
    .reverse()
    .filter((status) => counts[status] > 0)
    .map((status) => ({ status, text: `${counts[status]} ${BOOKING_ORDER_TEXT[status].short}` }));
  if (parts.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
      {parts.map((part) => (
        <span
          key={part.status}
          className={
            part.status === "unexplained"
              ? "font-semibold text-rose-700"
              : part.status === "fifo"
                ? "text-emerald-800"
                : "text-sky-800"
          }
        >
          {part.text}
        </span>
      ))}
    </p>
  );
}

/**
 * Records why a patient was booked out of order: a reason from the fixed list,
 * plus an optional typed note. The reason is what exports carry; the note stays
 * on screen and in the notes file.
 */
export function OrderReasonEditor({
  label,
  reason,
  onChange,
}: {
  label: string;
  reason: OrderReason | undefined;
  onChange: (reason: OrderReason | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="flex items-center gap-2">
        {label}
        <select
          value={reason?.code ?? ""}
          onChange={(event) => {
            const code = event.target.value as OrderReasonCode | "";
            if (!code) onChange(undefined);
            else onChange(reason?.note ? { code, note: reason.note } : { code });
          }}
          className="rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
        >
          <option value="">No reason recorded</option>
          {ORDER_REASONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {reason && (
        <input
          type="text"
          value={reason.note ?? ""}
          maxLength={ORDER_REASON_NOTE_MAX}
          placeholder="Optional note (not exported)"
          aria-label="Optional note, not exported"
          onChange={(event) => {
            const note = event.target.value;
            onChange(note ? { code: reason.code, note } : { code: reason.code });
          }}
          className="w-56 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
        />
      )}
    </div>
  );
}

/**
 * Asks for the reason at the moment a patient is moved, while whoever moved
 * them still knows why. It can be dismissed without answering: the patient
 * then stays listed at the top of the slates tab until a reason is recorded.
 */
export function OrderReasonPrompt({
  patientLabel,
  caseId,
  what,
  reason,
  onChange,
  onClose,
}: {
  patientLabel: string;
  caseId: string;
  /** What was done, completing "This patient was …". */
  what: string;
  reason: OrderReason | undefined;
  onChange: (reason: OrderReason | undefined) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-reason-prompt-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="order-reason-prompt-title" className="text-lg font-semibold text-slateBlue-900">
          Why was this patient moved?
        </h2>
        <p className="mt-2 text-sm text-sand-800">
          <span className="font-semibold text-slateBlue-900">{patientLabel}</span>
          <span className="ml-1.5 text-[10px] uppercase tracking-wider text-sand-400">{caseId}</span>{" "}
          was {what}.
        </p>
        <div className="mt-4 flex justify-start text-xs text-sand-700">
          <OrderReasonEditor label="Reason" reason={reason} onChange={onChange} />
        </div>
        <p className="mt-3 text-xs text-sand-600">
          Only a reason from this list can appear on an export; a typed note never does. If you
          skip this, the patient stays listed at the top of the slates tab until a reason is
          recorded.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={
              reason
                ? "rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                : "rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            }
          >
            {reason ? "Done" : "Skip for now"}
          </button>
        </div>
      </div>
    </div>
  );
}
