// Turns the rows of a hospital waitlist spreadsheet (.xlsx/.xls) into the CSV
// the importer reads. The hospital's export has these columns:
//
//   SURGEON, PAT_NAME1, PHN, SURG_DESC, BOOK_FORM_RECEIVED_DTM, REQUEST_QUEUE,
//   DIAGNOSIS, TIME_WAITING, TARGET_TIME, TARGET_PERCENT
//
// PAT_NAME1 is "SURNAME, FIRSTNAME" and is shown as given. SURG_DESC is the
// primary procedure, which sets the default case length. DIAGNOSIS is a BC
// diagnosis code (e.g. 50RMMB); older exports put the procedure there instead,
// so it is used for the procedure only when SURG_DESC is missing or blank.
// TIME_WAITING and TARGET_TIME are in weeks (TARGET_TIME as e.g. "12.00 wks").
// REQUEST_QUEUE is passed through so that procedural sedation (PS) rows can be
// left out and reported (see isProceduralSedationQueue). The other columns are
// not used.

import { csvEscape } from "./format";
import { clinicalFlagDefinitions } from "./types";

export type SpreadsheetRow = Record<string, string | number | boolean | null | undefined>;

const cell = (row: SpreadsheetRow, key: string) => String(row[key] ?? "").trim();

export function normalizeOfficeWorkbookToCsv(rows: SpreadsheetRow[]): string {
  const headers = [
    "source_key",
    "patient_ref",
    "benchmark",
    "time_waiting_weeks",
    "estimated_duration_min",
    "unavailable_until",
    "surgeon_id",
    "procedure_name",
    ...clinicalFlagDefinitions.map((flag) => flag.csvColumn),
    "request_queue",
  ];

  const lines = [headers.join(",")];

  rows.forEach((row, index) => {
    const patientName = cell(row, "PAT_NAME1");
    const phn = cell(row, "PHN");
    const procedure = cell(row, "SURG_DESC") || cell(row, "DIAGNOSIS");
    // A name or PHN identifies the patient; a row with neither (an anonymised
    // extract) is named by its spreadsheet row so each case stays distinct.
    const sourceKey = patientName || phn || `Office row ${index + 2}`;
    // patient_ref (PHN) is the stable key for matching notes between weeks; it
    // stays in the browser and is never written to slate/mapping/priority
    // exports.
    const values = [
      sourceKey,
      phn,
      cell(row, "TARGET_TIME"),
      cell(row, "TIME_WAITING"),
      "",
      "",
      cell(row, "SURGEON"),
      procedure,
      ...clinicalFlagDefinitions.map(() => ""),
      cell(row, "REQUEST_QUEUE"),
    ];
    lines.push(values.map((value) => csvEscape(value)).join(","));
  });

  return lines.join("\n");
}
