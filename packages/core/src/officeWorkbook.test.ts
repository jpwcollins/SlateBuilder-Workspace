import { describe, expect, it } from "vitest";
import { normalizeOfficeWorkbookToCsv } from "./officeWorkbook";
import { isProceduralSedationQueue, parseCsv } from "./csv";
import { checkImportedWaitlist } from "./importCheck";

// Rows shaped like the hospital's current export. All values are invented.
const row = (over: Record<string, string> = {}) => ({
  SURGEON: "Doe, Jane, MD",
  PAT_NAME1: "SMITH, ALEX",
  PHN: "9990001234",
  SURG_DESC: "Hysteroscopy with Polypectomy",
  BOOK_FORM_RECEIVED_DTM: "4-May-26",
  REQUEST_QUEUE: "SN - BCW Surgery Waitlist - GA",
  DIAGNOSIS: "50RMMB",
  TIME_WAITING: "29.57",
  TARGET_TIME: "            12.00 wks",
  TARGET_PERCENT: "246%",
  ...over,
});

const load = (rows: Record<string, string>[]) => parseCsv(normalizeOfficeWorkbookToCsv(rows));

describe("normalizeOfficeWorkbookToCsv (current hospital export)", () => {
  it("reads every field the app uses", () => {
    const { cases, skipped } = load([row()]);
    expect(skipped).toEqual([]);
    const c = cases[0];
    expect(c.displayLabel).toBe("SMITH, ALEX");
    expect(c.surgeonId).toBe("Doe, Jane, MD");
    expect(c.procedureName).toBe("Hysteroscopy with Polypectomy");
    expect(c.benchmarkWeeks).toBe(12);
    expect(c.timeToTargetDays).toBe(12 * 7 - Math.round(29.57 * 7));
  });

  it("takes the default case length from SURG_DESC, not the diagnosis code", () => {
    const { cases } = load([
      row({ SURG_DESC: "Hysteroscopy with Dilatation and Curettage" }),
      row({ SURG_DESC: "Salpingo Oophorectomy Laparoscopic Bilateral" }),
      row({ SURG_DESC: "Hysterectomy Total Laparoscopic" }),
      row({ SURG_DESC: "Repair Cystocele and Rectocele" }),
    ]);
    expect(cases.map((c) => c.estimatedDurationMin)).toEqual([30, 60, 180, 90]);
  });

  it("falls back to DIAGNOSIS for the procedure when SURG_DESC is missing", () => {
    const { cases } = load([row({ SURG_DESC: "", DIAGNOSIS: "Fibroids - Total Abdominal Hysterectomy" })]);
    expect(cases[0].procedureName).toBe("Fibroids - Total Abdominal Hysterectomy");
    expect(cases[0].estimatedDurationMin).toBe(180);
  });

  it("numbers rows with no name or PHN so each stays distinct", () => {
    const { cases } = load([row({ PAT_NAME1: "", PHN: "" }), row({ PAT_NAME1: "", PHN: "" })]);
    expect(cases.map((c) => c.displayLabel)).toEqual(["Office row 2", "Office row 3"]);
  });

  it("reads a 26-week target", () => {
    const { cases } = load([row({ TARGET_TIME: "            26.00 wks", TIME_WAITING: "63.57" })]);
    expect(cases[0].benchmarkWeeks).toBe(26);
  });
});

describe("procedural sedation (PS) rows", () => {
  it("are left out and recorded as skipped on purpose", () => {
    const { cases, skipped } = load([
      row(),
      row({ PAT_NAME1: "JONES, SAM", REQUEST_QUEUE: "SN - BCW Surgery Waitlist - PS" }),
      row({ PAT_NAME1: "LEE, KIM" }),
    ]);
    expect(cases.map((c) => c.displayLabel)).toEqual(["SMITH, ALEX", "LEE, KIM"]);
    expect(skipped).toEqual([{ row: 3, reason: "procedural-sedation", sourceKey: "JONES, SAM" }]);
  });

  it("are reported on their own, not as patients who failed to load", () => {
    const parsed = load([row(), row({ REQUEST_QUEUE: "SN - BCW Surgery Waitlist - PS" })]);
    const checks = checkImportedWaitlist({ cases: parsed.cases, skipped: parsed.skipped, rowsRead: parsed.rowsRead });
    expect(checks.map((c) => c.id)).toContain("procedural-sedation");
    expect(checks.map((c) => c.id)).not.toContain("rows-dropped");
    const ps = checks.find((c) => c.id === "procedural-sedation")!;
    expect(ps.headline).toBe("1 procedural sedation (PS) case in the file was left out.");
    expect(ps.detail).toMatch(/^Row 3 is on the procedural sedation waitlist/);
  });

  it("recognises the queue only by its PS ending or name", () => {
    expect(isProceduralSedationQueue("SN - BCW Surgery Waitlist - PS")).toBe(true);
    expect(isProceduralSedationQueue("Procedural Sedation")).toBe(true);
    expect(isProceduralSedationQueue("SN - BCW Surgery Waitlist - GA")).toBe(false);
    expect(isProceduralSedationQueue("")).toBe(false);
    expect(isProceduralSedationQueue("Upstairs")).toBe(false);
  });
});

describe("parseCsv with both SURG_DESC and DIAGNOSIS columns", () => {
  it("keeps the procedure from SURG_DESC rather than the diagnosis code", () => {
    const csv = [
      "PAT_NAME1,SURGEON,SURG_DESC,DIAGNOSIS,TIME_WAITING,TARGET_TIME",
      '"SMITH, ALEX","Doe, Jane, MD",Hysterectomy Total Laparoscopic,50RMFD,10,12.00 wks',
    ].join("\n");
    const { cases } = parseCsv(csv);
    expect(cases[0].procedureName).toBe("Hysterectomy Total Laparoscopic");
    expect(cases[0].estimatedDurationMin).toBe(180);
  });

  it("still reads the procedure from DIAGNOSIS in older exports", () => {
    const csv = [
      "PAT_NAME1,SURGEON,DIAGNOSIS,TIME_WAITING,TARGET_TIME",
      "Priya Natarajan,Dr Jane,Endometrial Hyperplasia - Total Laparoscopic Hysterectomy,5,2w",
    ].join("\n");
    expect(parseCsv(csv).cases[0].procedureName).toBe(
      "Endometrial Hyperplasia - Total Laparoscopic Hysterectomy",
    );
  });
});
