import { describe, expect, it } from "vitest";
import { csvEscape, sanitizeCsvCell, serializeCsv } from "./format";

describe("sanitizeCsvCell", () => {
  it("neutralizes leading formula triggers", () => {
    expect(sanitizeCsvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(sanitizeCsvCell("+1")).toBe("'+1");
    expect(sanitizeCsvCell("-2")).toBe("'-2");
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves ordinary values untouched", () => {
    expect(sanitizeCsvCell("Hysteroscopy")).toBe("Hysteroscopy");
    expect(sanitizeCsvCell("C-001")).toBe("C-001");
  });
});

describe("csvEscape", () => {
  it("quotes values containing commas or quotes after guarding", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    // Guard then quote: leading "=" plus an embedded comma.
    expect(csvEscape("=a,b")).toBe('"\'=a,b"');
  });
});

describe("serializeCsv", () => {
  it("prefixes the Excel separator hint", () => {
    const out = serializeCsv([["a", "b"], ["1", "2"]]);
    expect(out.split("\n")[0]).toBe("sep=,");
    expect(out).toContain("a,b");
  });
});
