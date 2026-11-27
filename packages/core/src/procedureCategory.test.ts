import { describe, expect, it } from "vitest";
import {
  classifyProcedure,
  isProcedureNotPerformed,
  minutesForCategory,
  STANDARD_DURATIONS,
} from "./procedureCategory";
import { applyDefaultDuration } from "./caseHelpers";
import { checkImportedWaitlist } from "./importCheck";
import { parseCsv } from "./csv";
import { PatientCase } from "./types";

const minutes = (name: string) =>
  minutesForCategory(classifyProcedure(name).category, STANDARD_DURATIONS);

describe("classifyProcedure", () => {
  it("puts known procedures in their tier, whatever the case or spacing", () => {
    expect(minutes("Marsupialization Bartholin Cyst")).toBe(30);
    expect(minutes("  insertion   intrauterine device ")).toBe(30);
    expect(minutes("Sling Bladder Transvaginal Tape")).toBe(60);
    expect(minutes("Repair Rectocele")).toBe(60);
    expect(minutes("Repair Cystocele and Rectocele")).toBe(90);
    expect(minutes("Colpocleisis")).toBe(90);
  });

  it("keeps the named approaches", () => {
    expect(minutes("Hysteroscopy with Dilatation and Curettage")).toBe(30);
    expect(minutes("Myomectomy Laparoscopic")).toBe(60);
    expect(minutes("Hysterectomy Total Laparoscopic")).toBe(180);
  });

  it("takes a name with no approach as laparoscopic, and says so", () => {
    const c = classifyProcedure("Salpingectomy");
    expect(c.category).toBe("laparoscopy");
    expect(c.assumption).toMatch(/taken as laparoscopic/);
  });

  it("gives an unknown or missing procedure the Other – major length, and says so", () => {
    expect(classifyProcedure("Something New").category).toBe("otherMajor");
    expect(classifyProcedure("Something New").assumption).toMatch(/not a procedure the app recognises/i);
    expect(classifyProcedure("").assumption).toMatch(/No procedure given/);
  });

  it("makes no assumption for procedures it knows outright", () => {
    expect(classifyProcedure("Repair Cystocele").assumption).toBeUndefined();
    expect(classifyProcedure("Hysteroscopy with Polypectomy").assumption).toBeUndefined();
  });

  it("uses the office's own lengths, with older saved settings falling back", () => {
    const item = { procedureName: "Labiaplasty" } as PatientCase;
    expect(applyDefaultDuration(item, { ...STANDARD_DURATIONS, otherIntermediate: 75 }).estimatedDurationMin).toBe(75);
    const older = { hysteroscopy: 30, laparoscopy: 60, hysterectomy: 180, other: 90 };
    expect(applyDefaultDuration(item, older).estimatedDurationMin).toBe(60);
  });

  it("recognises Procedure Not Performed", () => {
    expect(isProcedureNotPerformed("Procedure Not Performed")).toBe(true);
    expect(isProcedureNotPerformed("Procedure not Performed - Not supported by SPR")).toBe(true);
    expect(isProcedureNotPerformed("Repair Rectocele")).toBe(false);
  });
});

describe("import: Procedure Not Performed and assumed lengths", () => {
  const csv = [
    "PAT_NAME1,SURG_DESC,TIME_WAITING,TARGET_TIME",
    '"SMITH, ALEX",Salpingectomy,5,12.00 wks',
    '"JONES, SAM",Procedure Not Performed,5,12.00 wks',
    '"LEE, KIM",Salpingectomy,5,12.00 wks',
    '"WU, MEI",Something New,5,12.00 wks',
    '"ROE, PAT",Repair Rectocele,5,12.00 wks',
  ].join("\n");
  const parsed = parseCsv(csv);
  const checks = checkImportedWaitlist(parsed);

  it("leaves Procedure Not Performed rows out and says so", () => {
    expect(parsed.cases.map((c) => c.displayLabel)).not.toContain("JONES, SAM");
    const note = checks.find((c) => c.id === "procedure-not-performed")!;
    expect(note.headline).toBe("1 row marked Procedure Not Performed was left out.");
    expect(checks.map((c) => c.id)).not.toContain("rows-dropped");
  });

  it("lists each assumed procedure once, with how many patients", () => {
    const note = checks.find((c) => c.id === "assumed-case-length")!;
    expect(note.headline).toBe("The case length for 3 patients rests on an assumption.");
    expect(note.detail).toMatch(/^Salpingectomy \(2\): No approach given.*Default length: Laparoscopy\./);
    expect(note.detail).toMatch(/Something New \(1\): Not a procedure the app recognises.*Other – major/);
    expect(note.detail).not.toMatch(/Rectocele/);
  });
});
