// CSV serialization shared by both apps.
//
// These exports open in Excel on clinic machines, so every cell is guarded
// against CSV/formula injection: a value beginning with =, +, -, @, or a
// leading tab/carriage return is treated by spreadsheets as a live formula
// (e.g. "=cmd|...") unless neutralized. We prefix such values with a single
// quote so they import as plain text.

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

export function sanitizeCsvCell(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGERS.includes(value[0])) {
    return `'${value}`;
  }
  return value;
}

export function csvEscape(value: string): string {
  const guarded = sanitizeCsvCell(value);
  if (guarded.includes(",") || guarded.includes('"') || guarded.includes("\n")) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function serializeCsv(rows: string[][]): string {
  return ["sep=,", ...rows.map((row) => row.map((cell) => csvEscape(cell)).join(","))].join("\n");
}
