import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("accounts for every row that carried data but produced no patient", () => {
    // A row with content and no way to place it in time used to vanish
    // silently -- the worst thing this parser can do to a surgical waitlist.
    const csv = [
      "source_key,benchmark,time_to_target_days",
      "Present,12w,5",
      "No wait info,,",
      "Bad benchmark,someday,5",
    ].join("\n");
    const result = parseCsv(csv);
    expect(result.cases).toHaveLength(1);
    expect(result.rowsRead).toBe(3);
    expect(result.skipped).toEqual([
      { row: 3, reason: "no-wait-information", sourceKey: "No wait info" },
      {
        row: 4,
        reason: "unrecognized-benchmark",
        sourceKey: "Bad benchmark",
        offendingValue: "someday",
      },
    ]);
  });

  it("summarizes rather than listing a bullet for every skipped row", () => {
    // A file missing its benchmark column skips every row; an 800-bullet list
    // reads as a broken app rather than as 800 missing patients.
    const rows = Array.from({ length: 40 }, (_, i) => `P${i},,`);
    const result = parseCsv(["source_key,benchmark,time_to_target_days", ...rows].join("\n"));
    expect(result.cases).toHaveLength(0);
    expect(result.skipped).toHaveLength(40);
    expect(result.warnings.length).toBeLessThan(12);
    expect(result.warnings.at(-1)).toContain("32 more rows skipped");
  });

  it("does not count blank lines as rows", () => {
    const csv = ["source_key,benchmark,time_to_target_days", "A,12w,5", ",,", "B,12w,5"].join("\n");
    const result = parseCsv(csv);
    expect(result.rowsRead).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it("assigns opaque case codes and keeps the identifier as the display label", () => {
    const csv = ["source_key,benchmark,time_to_target_days", "Jane Doe,2w,5"].join("\n");
    const { cases } = parseCsv(csv);
    expect(cases).toHaveLength(1);
    expect(cases[0].caseId).toMatch(/^C-\d{3}$/);
    expect(cases[0].displayLabel).toContain("Jane Doe");
    // The opaque code must not embed the patient identifier.
    expect(cases[0].caseId).not.toContain("Jane");
  });

  it("gives stable codes across re-parses of the same content", () => {
    const csv = ["source_key,benchmark,time_to_target_days", "A,2w,1", "B,4w,2"].join("\n");
    const first = parseCsv(csv).cases.map((c) => c.caseId);
    const second = parseCsv(csv).cases.map((c) => c.caseId);
    expect(first).toEqual(second);
    expect(first).toEqual(["C-001", "C-002"]);
  });

  it("honors target_time_weeks over the benchmark class when deriving TTT", () => {
    // benchmark 6w but real target 4w, waited 2w -> 4*7 - 2*7 = 14 days to target.
    const csv = [
      "source_key,benchmark,target_time_weeks,time_waiting_weeks",
      "A,6w,4,2",
    ].join("\n");
    const { cases } = parseCsv(csv);
    expect(cases[0].timeToTargetDays).toBe(14);
  });

  it("derives TTT from weeks waited against the benchmark when no explicit target", () => {
    const csv = ["source_key,benchmark,time_waiting_weeks", "A,6w,8"].join("\n");
    const { cases } = parseCsv(csv);
    // 6*7 - 8*7 = -14 (overdue by two weeks)
    expect(cases[0].timeToTargetDays).toBe(-14);
  });

  it("reads a bare TIME_WAITING header as weeks, matching hospital exports", () => {
    // Raw hospital columns: TARGET_TIME and TIME_WAITING are both in weeks.
    // 4-week target, waited 11 weeks -> 4*7 - 11*7 = -49 days (overdue),
    // NOT 4*7 - 11 = 17 days (the old days-alias misread).
    const csv = ["source_key,target_time,time_waiting", "A,4,11"].join("\n");
    const { cases } = parseCsv(csv);
    expect(cases[0].timeToTargetDays).toBe(-49);
  });

  it("parses a raw hospital CSV header row end to end", () => {
    // A file saved as CSV straight from the hospital's Excel export must behave
    // identically to the XLSX path: names shown, PHN kept as the stable
    // patient_ref, diagnosis used for duration inference, weeks as weeks.
    const csv = [
      "PAT_NAME1,PHN,SURGEON,DIAGNOSIS,TARGET_TIME,TIME_WAITING",
      '"Kaur, Harpreet",9043334445,Dr Collins,Fibroids - Total Hysterectomy,4,11',
    ].join("\n");
    const { cases } = parseCsv(csv);
    expect(cases).toHaveLength(1);
    expect(cases[0].displayLabel).toBe("Patient Kaur, Harpreet");
    expect(cases[0].patientRef).toBe("9043334445");
    expect(cases[0].timeToTargetDays).toBe(-49);
    expect(cases[0].estimatedDurationMin).toBe(180); // hysterectomy, not the 90m default
    expect(cases[0].surgeonId).toBe("Dr Collins");
  });

  it("keeps sourceKey as the raw uploaded identifier, distinct from displayLabel", () => {
    const csv = ["source_key,benchmark,time_to_target_days", "Jane Doe,2w,5"].join("\n");
    const { cases } = parseCsv(csv);
    expect(cases[0].sourceKey).toBe("Jane Doe");
    expect(cases[0].displayLabel).toBe("Patient Jane Doe");
  });

  it("warns and skips a row whose benchmark value is not a real benchmark", () => {
    const csv = [
      "source_key,benchmark,time_to_target_days",
      "A,9876543210,5",
    ].join("\n");
    const { cases, warnings } = parseCsv(csv);
    expect(cases).toHaveLength(0);
    expect(warnings.some((w) => w.includes("not recognised"))).toBe(true);
  });

  it("distinguishes a blank target time from one it could not understand", () => {
    // Different fixes: a blank means a missing column or value, while an
    // unrecognised value means the column is there and says something odd.
    const blank = parseCsv(
      ["source_key,benchmark,time_waiting_weeks", "A,,12"].join("\n")
    );
    const odd = parseCsv(
      ["source_key,benchmark,time_waiting_weeks", "A,someday,12"].join("\n")
    );
    expect(blank.warnings.some((w) => w.includes("no target time given"))).toBe(true);
    expect(odd.warnings.some((w) => w.includes("'someday' not recognised"))).toBe(true);
  });
});
