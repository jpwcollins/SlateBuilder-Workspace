import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
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
});
