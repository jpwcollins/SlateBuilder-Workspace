import { describe, expect, it } from "vitest";
import {
  buildAllSlatesPdfDoc,
  buildSlatePdfDoc,
  buildWaitlistPdfDoc,
  SlatePdfCase,
  SlatePdfOptions,
  WaitlistPdfRow,
} from "./slatePdf";

function makeSlateCase(order: number): SlatePdfCase {
  return {
    order,
    startLabel: "0800",
    endLabel: "0830",
    durationMin: 30,
    tatAfter: true,
    benchmarkWeeks: 2,
    overdueDays: 0,
    primary: `Patient ${order}`,
    secondary: `C-${String(order).padStart(3, "0")}`,
    procedure: "Hysteroscopy",
    flags: [],
    inpatient: false,
  };
}

function makeSlateOptions(overrides: Partial<SlatePdfOptions> = {}): SlatePdfOptions {
  return {
    surgeonName: "Dr. Smith",
    orDateLabel: "Thursday, 8 January 2026",
    blockLabel: "0800–1600 · 480 min",
    summaryLabel: "1 case · 10% utilization",
    cases: [makeSlateCase(1)],
    fileName: "slate.pdf",
    ...overrides,
  };
}

function makeWaitlistRow(rank: number): WaitlistPdfRow {
  return {
    rank,
    primary: `Patient ${rank}`,
    secondary: `C-${String(rank).padStart(3, "0")}`,
    procedure: "Hysteroscopy",
    benchmarkWeeks: 2,
    timeToTargetDays: -1,
    overdueDays: 1,
    status: rank % 2 === 0 ? "Slated" : "Waiting",
  };
}

describe("buildSlatePdfDoc", () => {
  it("produces a single-page document for one slate", () => {
    const doc = buildSlatePdfDoc(makeSlateOptions());
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("does not throw on an empty case list", () => {
    const doc = buildSlatePdfDoc(makeSlateOptions({ cases: [] }));
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe("buildAllSlatesPdfDoc", () => {
  it("emits exactly one page per slate", () => {
    const slates = [makeSlateOptions(), makeSlateOptions(), makeSlateOptions()];
    const doc = buildAllSlatesPdfDoc(slates);
    expect(doc.getNumberOfPages()).toBe(3);
  });
});

describe("buildWaitlistPdfDoc pagination", () => {
  // Regression coverage for the rowsPerPage computation: it must stay a
  // sensible positive number (and page counts must track row counts) even if
  // the row-height/margin constants change later.
  function pagesFor(rowCount: number): number {
    const rows = Array.from({ length: rowCount }, (_, i) => makeWaitlistRow(i + 1));
    const doc = buildWaitlistPdfDoc({
      surgeonName: "Dr. Smith",
      generatedLabel: "Generated 2026-01-08",
      summaryLabel: `${rowCount} patients`,
      rows,
      fileName: "waitlist.pdf",
    });
    return doc.getNumberOfPages();
  }

  it("fits a small waitlist on one page", () => {
    expect(pagesFor(5)).toBe(1);
  });

  it("produces at least one page even with zero rows", () => {
    expect(pagesFor(0)).toBe(1);
  });

  it("adds a second page once the list exceeds one page's capacity", () => {
    // Capacity is derived from fixed layout constants; rather than hardcode
    // the exact row count, find where the page count first increases and
    // assert it's a sane, positive threshold (not 0/negative or absurdly
    // large, which would indicate the layout math broke).
    let firstRowCount = 1;
    while (pagesFor(firstRowCount) === 1) {
      firstRowCount += 1;
      expect(firstRowCount).toBeLessThan(200); // sanity bound
    }
    expect(pagesFor(firstRowCount)).toBe(2);
    expect(pagesFor(firstRowCount - 1)).toBe(1);
  });

  it("scales page count roughly linearly for a large waitlist", () => {
    const onePage = pagesFor(1);
    const manyPages = pagesFor(200);
    expect(manyPages).toBeGreaterThan(onePage);
  });
});
