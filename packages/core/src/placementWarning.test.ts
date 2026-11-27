import { describe, expect, it } from "vitest";
import { describePlacement, isPushedLater } from "./placementWarning";
import { scoreCases } from "./optimizer";
import { BenchmarkWeeks, PatientCase, ScoredCase } from "./types";

function c(id: string, name: string, benchmarkWeeks: BenchmarkWeeks, timeToTargetDays: number): ScoredCase {
  const item: PatientCase = {
    caseId: id,
    sourceKey: id,
    displayLabel: name,
    benchmarkWeeks,
    timeToTargetDays,
    estimatedDurationMin: 60,
    surgeonId: "DR1",
    flags: {},
  };
  return scoreCases([item])[0];
}

const megan = c("M", "Megan O'Connor", 26, -35);
const ruth = c("R", "Ruth Abernathy", 4, -14);
const sofia = c("S", "Sofia Marchetti", 6, -28);
const hannah = c("H", "Hannah Liu", 26, 100);
const lucia = c("L", "Lucia Moreno", 4, 7);
const cases = [megan, ruth, sofia, hannah, lucia];
const run = (moves: Parameters<typeof describePlacement>[0]["moves"]) =>
  describePlacement({ placed: megan, toDateISO: "2026-12-18", moves, cases, priorityMode: "urgency_then_ttt" });

describe("describePlacement", () => {
  it("returns null when nobody else moves", () => {
    expect(run([])).toBeNull();
  });

  it("lists higher-ranked patients pushed later first, with how overdue they are", () => {
    const result = run([
      { caseId: "R", fromDateISO: "2026-12-18", toDateISO: "2027-01-01" },
      { caseId: "S", fromDateISO: "2026-12-18", toDateISO: null },
      { caseId: "H", fromDateISO: "2027-01-01", toDateISO: "2027-01-15" },
    ]);
    expect(result?.higherRankedPushed).toEqual(["R", "S"]);
    const text = result!.message;
    expect(text).toContain("pushes 2 higher-ranked patients later:");
    expect(text).toContain("• Ruth Abernathy, 14 days overdue, priority");
    expect(text).toContain("→ Jan 1");
    expect(text).toContain("Sofia Marchetti, 28 days overdue");
    expect(text).toContain("→ back to the waitlist");
    expect(text).toContain("Other changes:\n• Hannah Liu: Jan 1 → Jan 15");
    expect(text).toContain("A reason for placing them ahead is needed.");
    expect(text.indexOf("Ruth")).toBeLessThan(text.indexOf("Other changes"));
    expect(result!.higherRanked[0]).toMatchObject({ label: "Ruth Abernathy", wait: "14 days overdue", toLabel: "Jan 1" });
    expect(result!.higherRanked[1].toLabel).toBe("back to the waitlist");
    expect(result!.otherChanges).toEqual([{ caseId: "H", text: "Hannah Liu: Jan 1 → Jan 15" }]);
    expect(result!.toLabel).toBe("Dec 18");
  });

  it("treats a lower-ranked patient pushed later, or anyone moved earlier, as routine", () => {
    const result = run([
      { caseId: "H", fromDateISO: "2026-12-18", toDateISO: "2027-01-01" },
      { caseId: "L", fromDateISO: "2027-01-15", toDateISO: "2026-12-18" },
      { caseId: "R", fromDateISO: null, toDateISO: "2027-01-01" },
    ]);
    expect(result?.higherRankedPushed).toEqual([]);
    expect(result!.message).toMatch(/^Placing Megan O'Connor on Dec 18 also changes:/);
    expect(result!.message).toContain("• Ruth Abernathy: from the waitlist → Jan 1");
    expect(result!.message).not.toContain("reason");
  });

  it("knows which moves are later", () => {
    expect(isPushedLater({ caseId: "x", fromDateISO: "2027-01-01", toDateISO: "2027-01-15" })).toBe(true);
    expect(isPushedLater({ caseId: "x", fromDateISO: "2027-01-01", toDateISO: null })).toBe(true);
    expect(isPushedLater({ caseId: "x", fromDateISO: "2027-01-15", toDateISO: "2027-01-01" })).toBe(false);
    expect(isPushedLater({ caseId: "x", fromDateISO: null, toDateISO: "2027-01-01" })).toBe(false);
  });
});
