import { jsPDF } from "jspdf";
import { BOOKING_ORDER_STATUSES, BOOKING_ORDER_TEXT, BookingOrderStatus } from "./bookingOrder";

// Single letter-size (portrait) OR slate sheets and a paginated priority
// waitlist. Built from text and drawn vector shapes only -- lines, rectangles,
// circles and curves, including the booking-order icons -- with no images,
// forms or HTML, so none of jsPDF's parsing surface is exercised.

export type SlatePdfCase = {
  order: number;
  startLabel: string; // "0800"
  endLabel: string; // "0930"
  durationMin: number;
  tatAfter: boolean; // a 30-min turnaround follows this case
  benchmarkWeeks: number;
  overdueDays: number; // days past target, 0 if not overdue
  primary: string; // name (or opaque code when names are hidden)
  secondary?: string; // opaque code shown under the name when names are included
  procedure: string;
  flags: string[]; // active clinical flag labels
  inpatient: boolean;
  /**
   * Whether the case was booked in priority order and, if not, why. Printed as
   * an icon plus a word at the top of the notes column, with a key at the foot
   * of the page. Omit to leave the sheet as it was before the indicator existed.
   */
  bookingOrder?: { status: BookingOrderStatus; reasons: string[] };
};

export type SlatePdfOptions = {
  surgeonName: string;
  orDateLabel: string; // "Thursday, 8 January 2026"
  blockLabel: string; // "0800–1600 · 480 min"
  summaryLabel: string; // "5 cases · 78% utilization"
  /**
   * One line printed in red under the block details, for something about the
   * slate as a whole that no single row carries — in practice, that a
   * higher-ranked patient was held back from it with no reason recorded.
   */
  slateNote?: string;
  cases: SlatePdfCase[];
  fileName: string;
};

export type WaitlistPdfRow = {
  rank: number;
  primary: string;
  secondary?: string;
  procedure: string;
  benchmarkWeeks: number;
  timeToTargetDays: number;
  overdueDays: number;
  status: "Slated" | "Waiting";
};

export type WaitlistPdfOptions = {
  heading?: string; // defaults to "PRIORITY WAITLIST"
  surgeonName: string;
  generatedLabel: string;
  summaryLabel: string;
  rows: WaitlistPdfRow[];
  fileName: string;
};

const NAVY: RGB = [23, 37, 84];
const INK: RGB = [38, 38, 44];
const GREY: RGB = [120, 120, 120];
const RULE: RGB = [203, 203, 203];
const FAINT: RGB = [225, 225, 225];
const RED: RGB = [178, 34, 52];
const WHITE: RGB = [255, 255, 255];
const GREEN: RGB = [22, 128, 84];
const BLUE: RGB = [36, 104, 168];

type RGB = [number, number, number];

// Urgency palette keyed by benchmark class.
function urgencyColor(weeks: number): RGB {
  if (weeks <= 2) return [190, 40, 55]; // rose
  if (weeks <= 4) return [200, 90, 30]; // orange
  if (weeks <= 6) return [176, 132, 22]; // amber
  if (weeks <= 12) return [40, 110, 170]; // sky
  return [110, 120, 140]; // slate/grey
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const RIGHT = PAGE_W - MARGIN;
const ROW_H = 84;

const COLS = {
  num: [MARGIN, 26],
  time: [74, 92],
  patient: [166, 168],
  proc: [334, 120],
  notes: [454, 110],
} as const;

// ---------------------------------------------------------------- Slate sheet

function renderSlatePage(doc: jsPDF, opts: SlatePdfOptions): void {
  drawSlateHeader(doc, opts);
  drawSlateTable(doc, opts.cases);
  const showKey = opts.cases.some((c) => c.bookingOrder);
  if (showKey) drawBookingOrderKey(doc);
  drawFooter(doc, showKey);
}

// ------------------------------------------------------- Booking-order marks

function bookingOrderColor(status: BookingOrderStatus): RGB {
  if (status === "fifo") return GREEN;
  if (status === "unexplained") return RED;
  return BLUE;
}

/**
 * Draws the status icon centred on (cx, cy), about 10pt across. Each status
 * has its own shape as well as its own colour, because these sheets are often
 * printed in black and white: a tick, a stethoscope, a clock, an exclamation.
 */
function drawBookingOrderIcon(
  doc: jsPDF,
  status: BookingOrderStatus,
  cx: number,
  cy: number
): void {
  const color = bookingOrderColor(status);
  doc.setLineCap("round");
  doc.setLineJoin("round");

  if (status === "fifo") {
    doc.setFillColor(...color);
    doc.circle(cx, cy, 5, "F");
    doc.setDrawColor(...WHITE);
    doc.setLineWidth(1.3);
    doc.line(cx - 2.5, cy + 0.2, cx - 0.7, cy + 2.1);
    doc.line(cx - 0.7, cy + 2.1, cx + 2.6, cy - 1.9);
  } else if (status === "unexplained") {
    doc.setFillColor(...color);
    doc.circle(cx, cy, 5, "F");
    doc.setDrawColor(...WHITE);
    doc.setLineWidth(1.4);
    doc.line(cx, cy - 2.8, cx, cy + 0.7);
    doc.setFillColor(...WHITE);
    doc.circle(cx, cy + 2.7, 0.8, "F");
  } else if (status === "optimization") {
    doc.setDrawColor(...color);
    doc.setLineWidth(1.1);
    doc.circle(cx, cy, 4.5, "S");
    doc.line(cx, cy - 2.6, cx, cy);
    doc.line(cx, cy, cx + 2, cy + 1.3);
  } else {
    // Stethoscope: the two earpiece tubes joined in a U, a tube looping out
    // from the bottom of it, and the round chest piece at the end.
    doc.setDrawColor(...color);
    doc.setLineWidth(1.1);
    doc.lines(
      [
        [0, 3],
        [0, 2.6, 4, 2.6, 4, 0],
        [0, -3],
      ],
      cx - 4.4,
      cy - 4.6,
      [1, 1],
      "S"
    );
    doc.lines(
      [
        [0, 1.2],
        [0, 3, 5.6, 3, 5.6, 0.2],
      ],
      cx - 2.4,
      cy + 0.35,
      [1, 1],
      "S"
    );
    doc.circle(cx + 3.2, cy + 0.2, 1.6, "S");
  }

  doc.setLineCap("butt");
  doc.setLineJoin("miter");
}

/** One line at the foot of the sheet saying what the four marks mean. */
function drawBookingOrderKey(doc: jsPDF): void {
  const y = PAGE_H - 33;
  const gap = 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const lead = "Booking order:";
  const items = [...BOOKING_ORDER_STATUSES].reverse().map((status) => {
    const text = BOOKING_ORDER_TEXT[status].label.replace(/^Out of order: /, "");
    return { status, text: text.charAt(0).toUpperCase() + text.slice(1) };
  });
  const iconSpace = 14;
  const widthOf = (text: string) => doc.getTextWidth(text);
  const total =
    widthOf(lead) + items.reduce((sum, item) => sum + gap + iconSpace + widthOf(item.text), 0);
  let x = (PAGE_W - total) / 2;

  doc.setTextColor(...GREY);
  doc.text(lead, x, y);
  x += widthOf(lead);
  items.forEach((item) => {
    x += gap;
    drawBookingOrderIcon(doc, item.status, x + 5, y - 2.6);
    x += iconSpace;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(item.text, x, y);
    x += widthOf(item.text);
  });
}

export function buildSlatePdfDoc(opts: SlatePdfOptions): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  renderSlatePage(doc, opts);
  return doc;
}

export function buildAllSlatesPdfDoc(slates: SlatePdfOptions[]): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  slates.forEach((slate, index) => {
    if (index > 0) doc.addPage();
    renderSlatePage(doc, slate);
  });
  return doc;
}

export function downloadSlatePdf(opts: SlatePdfOptions): void {
  buildSlatePdfDoc(opts).save(opts.fileName);
}

export function downloadAllSlatesPdf(slates: SlatePdfOptions[], fileName: string): void {
  if (slates.length === 0) return;
  buildAllSlatesPdfDoc(slates).save(fileName);
}

function drawSlateHeader(doc: jsPDF, opts: SlatePdfOptions): void {
  const top = 56;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.setCharSpace(2);
  doc.text("SURGICAL SLATE", MARGIN, top);
  doc.setCharSpace(0);

  doc.setFontSize(22);
  doc.setTextColor(...NAVY);
  doc.text(opts.surgeonName || "Surgeon", MARGIN, top + 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(opts.orDateLabel, MARGIN, top + 50);

  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  doc.text(opts.summaryLabel, RIGHT, top, { align: "right" });
  doc.text(opts.blockLabel, RIGHT, top + 14, { align: "right" });
  if (opts.slateNote) {
    doc.setFontSize(9);
    doc.setTextColor(...RED);
    doc.text(opts.slateNote, RIGHT, top + 50, { align: "right" });
  }

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1);
  doc.line(MARGIN, top + 66, RIGHT, top + 66);
}

function drawSlateTable(doc: jsPDF, cases: SlatePdfCase[]): void {
  const tableTop = 140;
  const headerBottom = tableTop + 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text("#", COLS.num[0] + COLS.num[1] / 2, tableTop, { align: "center" });
  doc.text("TIME", COLS.time[0], tableTop);
  doc.text("PATIENT", COLS.patient[0], tableTop);
  doc.text("PROCEDURE", COLS.proc[0], tableTop);
  doc.text("NOTES", COLS.notes[0], tableTop);

  const rows = Math.max(cases.length, 1);
  const tableBottom = headerBottom + rows * ROW_H;

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, headerBottom, RIGHT, headerBottom);
  doc.line(MARGIN, tableBottom, RIGHT, tableBottom);
  doc.line(MARGIN, headerBottom, MARGIN, tableBottom);
  doc.line(RIGHT, headerBottom, RIGHT, tableBottom);
  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.5);
  [COLS.time[0], COLS.patient[0], COLS.proc[0], COLS.notes[0]].forEach((x) => {
    doc.line(x, headerBottom, x, tableBottom);
  });

  cases.forEach((c, i) => {
    const rowTop = headerBottom + i * ROW_H;
    if (i > 0) {
      doc.setDrawColor(...FAINT);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, rowTop, RIGHT, rowTop);
    }

    // Order number in an urgency-colored chip for instant visual triage.
    const chipX = COLS.num[0] + COLS.num[1] / 2 - 9;
    const chipY = rowTop + 10;
    doc.setFillColor(...urgencyColor(c.benchmarkWeeks));
    doc.roundedRect(chipX, chipY, 18, 18, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...WHITE);
    doc.text(String(c.order), COLS.num[0] + COLS.num[1] / 2, chipY + 13, { align: "center" });

    // Time, duration + benchmark, overdue marker, turnaround note.
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(`${c.startLabel}–${c.endLabel}`, COLS.time[0] + 4, rowTop + 20);
    let ty = rowTop + 34;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text(`${c.durationMin} min · ${c.benchmarkWeeks}w`, COLS.time[0] + 4, ty);
    if (c.overdueDays > 0) {
      ty += 12;
      doc.setTextColor(...RED);
      doc.text(`${c.overdueDays}d overdue`, COLS.time[0] + 4, ty);
    }
    if (c.tatAfter) {
      ty += 12;
      doc.setTextColor(...GREY);
      doc.text("+30 min turnaround", COLS.time[0] + 4, ty);
    }

    // Patient: primary + code + flags.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    const nameLines = doc.splitTextToSize(c.primary, COLS.patient[1] - 8).slice(0, 2);
    doc.text(nameLines, COLS.patient[0] + 4, rowTop + 20);
    let py = rowTop + 20 + nameLines.length * 13;
    if (c.secondary) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...GREY);
      doc.text(c.secondary, COLS.patient[0] + 4, py);
      py += 12;
    }
    const tags = [...c.flags];
    if (c.inpatient) tags.unshift("Inpatient");
    if (tags.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...GREY);
      const tagLines = doc.splitTextToSize(tags.join(" · "), COLS.patient[1] - 8).slice(0, 2);
      doc.text(tagLines, COLS.patient[0] + 4, py);
    }

    // Procedure.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const procLines = doc.splitTextToSize(c.procedure || "—", COLS.proc[1] - 8).slice(0, 4);
    doc.text(procLines, COLS.proc[0] + 4, rowTop + 20);

    // Booking order: icon and word at the top of the notes column, where the
    // eye can run straight down the right-hand edge of the sheet.
    if (c.bookingOrder) {
      const { status, reasons } = c.bookingOrder;
      drawBookingOrderIcon(doc, status, COLS.notes[0] + 12, rowTop + 15);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...bookingOrderColor(status));
      doc.text(BOOKING_ORDER_TEXT[status].short, COLS.notes[0] + 21, rowTop + 18);
      // Only a clinical exception has a reason worth the space: the other
      // statuses say everything in their one word.
      if (status === "clinical" && reasons.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...GREY);
        const reasonLines = doc
          .splitTextToSize(reasons.join("; "), COLS.notes[1] - 12)
          .slice(0, 2);
        doc.text(reasonLines, COLS.notes[0] + 6, rowTop + 29);
      }
    }

    // Notes: faint guide lines for handwriting, moved down to clear the
    // booking-order mark when there is one.
    doc.setDrawColor(...FAINT);
    doc.setLineWidth(0.5);
    (c.bookingOrder ? [50, 70] : [38, 60]).forEach((dy) => {
      doc.line(COLS.notes[0] + 6, rowTop + dy, COLS.notes[0] + COLS.notes[1] - 6, rowTop + dy);
    });
  });
}

// ------------------------------------------------------------ Waitlist (multi-page)

const WL_COLS = {
  rank: [MARGIN, 26],
  patient: [74, 132],
  proc: [206, 150],
  bench: [356, 44],
  ttt: [400, 56],
  status: [456, 108],
} as const;

const WL_ROW_H = 26;
const WL_TABLE_TOP = 132;
const WL_BOTTOM_LIMIT = PAGE_H - 56;

export function buildWaitlistPdfDoc(opts: WaitlistPdfOptions): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const rowsPerPage = Math.floor((WL_BOTTOM_LIMIT - (WL_TABLE_TOP + WL_ROW_H)) / WL_ROW_H);
  const pageCount = Math.max(1, Math.ceil(opts.rows.length / rowsPerPage));

  for (let page = 0; page < pageCount; page += 1) {
    if (page > 0) doc.addPage();
    drawWaitlistHeader(doc, opts, page + 1, pageCount);
    const slice = opts.rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    drawWaitlistRows(doc, slice);
    drawFooter(doc);
  }
  return doc;
}

export function downloadWaitlistPdf(opts: WaitlistPdfOptions): void {
  if (opts.rows.length === 0) return;
  buildWaitlistPdfDoc(opts).save(opts.fileName);
}

function drawWaitlistHeader(
  doc: jsPDF,
  opts: WaitlistPdfOptions,
  page: number,
  pageCount: number
): void {
  const top = 56;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.setCharSpace(2);
  doc.text(opts.heading ?? "PRIORITY WAITLIST", MARGIN, top);
  doc.setCharSpace(0);

  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text(opts.surgeonName || "Office waitlist", MARGIN, top + 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  doc.text(opts.summaryLabel, RIGHT, top, { align: "right" });
  doc.text(opts.generatedLabel, RIGHT, top + 14, { align: "right" });
  if (pageCount > 1) {
    doc.text(`Page ${page} of ${pageCount}`, RIGHT, top + 28, { align: "right" });
  }

  // Column headers.
  const hy = WL_TABLE_TOP;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text("#", WL_COLS.rank[0] + WL_COLS.rank[1] / 2, hy, { align: "center" });
  doc.text("PATIENT", WL_COLS.patient[0], hy);
  doc.text("PROCEDURE", WL_COLS.proc[0], hy);
  doc.text("BENCH", WL_COLS.bench[0], hy);
  doc.text("TTT", WL_COLS.ttt[0], hy);
  doc.text("STATUS", WL_COLS.status[0], hy);

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, hy + 6, RIGHT, hy + 6);
}

function drawWaitlistRows(doc: jsPDF, rows: WaitlistPdfRow[]): void {
  const startY = WL_TABLE_TOP + WL_ROW_H;
  rows.forEach((r, i) => {
    const baseline = startY + i * WL_ROW_H;
    if (i > 0) {
      doc.setDrawColor(...FAINT);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, baseline - 16, RIGHT, baseline - 16);
    }

    // Rank chip (urgency colored).
    const chipX = WL_COLS.rank[0] + WL_COLS.rank[1] / 2 - 8;
    doc.setFillColor(...urgencyColor(r.benchmarkWeeks));
    doc.roundedRect(chipX, baseline - 12, 16, 15, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...WHITE);
    doc.text(String(r.rank), WL_COLS.rank[0] + WL_COLS.rank[1] / 2, baseline - 1, {
      align: "center",
    });

    // Patient (+ code).
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const name = doc.splitTextToSize(r.primary, WL_COLS.patient[1] - 6)[0] ?? r.primary;
    doc.text(name, WL_COLS.patient[0], baseline - 1);
    if (r.secondary) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...GREY);
      doc.text(r.secondary, WL_COLS.patient[0], baseline + 9);
    }

    // Procedure.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const proc = doc.splitTextToSize(r.procedure || "—", WL_COLS.proc[1] - 6)[0] ?? "—";
    doc.text(proc, WL_COLS.proc[0], baseline - 1);

    // Benchmark.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...urgencyColor(r.benchmarkWeeks));
    doc.text(`${r.benchmarkWeeks}w`, WL_COLS.bench[0], baseline - 1);

    // TTT (red when overdue).
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...(r.overdueDays > 0 ? RED : INK));
    doc.text(`${r.timeToTargetDays}d`, WL_COLS.ttt[0], baseline - 1);

    // Status.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...(r.status === "Slated" ? NAVY : GREY));
    doc.text(r.status, WL_COLS.status[0], baseline - 1);
  });
}

// ------------------------------------------------------------------- Shared

function drawFooter(doc: jsPDF, belowKey = false): void {
  doc.setDrawColor(...FAINT);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, PAGE_H - 44, RIGHT, PAGE_H - 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(belowKey ? 8 : 9);
  doc.setTextColor(...GREY);
  // A slate sheet with a booking-order key gives that line the usual spot and
  // sits just beneath it.
  doc.text("Generated with SlateBuilder", PAGE_W / 2, PAGE_H - (belowKey ? 21 : 28), {
    align: "center",
  });
}
