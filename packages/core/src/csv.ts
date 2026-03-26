import {
  BenchmarkWeeks,
  ClinicalFlags,
  PatientCase,
  clinicalFlagDefinitions,
} from "./types";

const headerAliases: Record<string, string> = {
  source_key: "source_key",
  sourcekey: "source_key",
  patient_key: "source_key",
  patient_identifier: "source_key",
  benchmark: "benchmark",
  benchmark_weeks: "benchmark",
  benchmark_time: "benchmark",
  target_time: "target_time",
  time_to_target: "time_to_target_days",
  time_to_target_days: "time_to_target_days",
  ttt_days: "time_to_target_days",
  time_waiting: "time_waiting_days",
  time_waiting_days: "time_waiting_days",
  time_waiting_weeks: "time_waiting_weeks",
  target_time_weeks: "target_time_weeks",
  target_time_week: "target_time_weeks",
  target_weeks: "target_time_weeks",
  elos: "elos",
  estimated_duration_min: "estimated_duration_min",
  duration_min: "estimated_duration_min",
  est_duration_min: "estimated_duration_min",
  unavailable_until: "unavailableUntil",
  patient_unavailable_until: "unavailableUntil",
  surgeon_id: "surgeon_id",
  surgeon: "surgeon_id",
  surgeon_desc: "procedure_name",
  surg_desc: "procedure_name",
  proc_code: "procedure_code",
  proc_desc: "procedure_name",
  procedure: "procedure_name",
  procedure_name: "procedure_name",
  procedure_desc: "procedure_name",
  surg_desc_name: "procedure_name",
  osa: "osa",
  diabetes: "diabetes",
  out_of_town: "outOfTown",
  outoftown: "outOfTown",
  high_bmi: "highBmi",
  highbmi: "highBmi",
  chronic_pain: "chronicPain",
  chronicpain: "chronicPain",
  special_assist: "specialAssist",
  specialassist: "specialAssist",
};

export type ParseResult = {
  cases: PatientCase[];
  warnings: string[];
};

export function parseCsv(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { cases: [], warnings: ["CSV is empty."] };
  }

  const header = splitCsvLine(lines[0]).map((h) => normalizeHeader(h));
  const normalized = header.map((h) => headerAliases[h] ?? h);

  const warnings: string[] = [];
  const cases: PatientCase[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const row = splitCsvLine(lines[i]);
    if (row.length === 0) continue;

    const record: Record<string, string> = {};
    for (let c = 0; c < normalized.length; c += 1) {
      record[normalized[c]] = (row[c] ?? "").trim();
    }
    if (Object.values(record).every((value) => value === "")) {
      continue;
    }

    const rawId = record["source_key"] || record["case_num"] || `row-${i}`;
    const sourceKey = rawId ? `Patient ${rawId}` : `Patient row-${i}`;
    const benchmarkRaw =
      record["benchmark"] || record["target_time_weeks"] || record["target_time"];
    if (!benchmarkRaw && !record["time_to_target_days"] && !record["time_waiting_days"] && !record["time_waiting_weeks"]) {
      continue;
    }
    const benchmarkWeeks = parseBenchmarkWeeks(benchmarkRaw);
    if (!benchmarkWeeks) {
      warnings.push(`Row ${i + 1}: unrecognized benchmark '${benchmarkRaw}'.`);
      continue;
    }

    const timeToTargetDaysRaw = toNumber(record["time_to_target_days"]);
    const timeWaitingDays = toNumber(record["time_waiting_days"]);
    const timeWaitingWeeks = toNumber(record["time_waiting_weeks"]);
    const targetWeeksRaw = record["target_time_weeks"] || record["target_time"];
    const targetWeeks = Number.isFinite(toNumber(targetWeeksRaw))
      ? toNumber(targetWeeksRaw)
      : Number.NaN;
    const timeToTargetDays = Number.isFinite(timeToTargetDaysRaw)
      ? timeToTargetDaysRaw
      : Number.isFinite(timeWaitingDays)
        ? benchmarkWeeks * 7 - timeWaitingDays
        : Number.isFinite(timeWaitingWeeks)
          ? benchmarkWeeks * 7 - timeWaitingWeeks * 7
          : Number.isFinite(targetWeeks) && Number.isFinite(timeWaitingWeeks)
            ? targetWeeks * 7 - timeWaitingWeeks * 7
        : Number.NaN;
    const roundedTimeToTargetDays = Number.isFinite(timeToTargetDays)
      ? Math.round(timeToTargetDays)
      : timeToTargetDays;

    const procedureName = record["procedure_name"] || "";
    let estimatedDurationMin = toNumber(record["estimated_duration_min"]);
    if (!Number.isFinite(estimatedDurationMin)) {
      estimatedDurationMin = inferDurationFromProcedure(procedureName);
      if (!Number.isFinite(estimatedDurationMin)) {
        estimatedDurationMin = 60;
      }
    }

    const surgeonId = record["surgeon_id"] || "UNKNOWN";
    const elos = toNumber(record["elos"]);
    const inpatient = Number.isFinite(elos) ? elos >= 1 : false;
    const unavailableUntil = record["unavailableUntil"] || "";

    if (!Number.isFinite(roundedTimeToTargetDays) || !Number.isFinite(estimatedDurationMin)) {
      warnings.push(`Row ${i + 1}: missing time-to-target or duration.`);
      continue;
    }

    const flags: ClinicalFlags = {};
    for (const [key, value] of Object.entries(record)) {
      if (clinicalFlagDefinitions.some((flag) => flag.key === key)) {
        flags[key] = parseBoolean(value);
      }
    }

    cases.push({
      caseId: sourceKey,
      sourceKey,
      benchmarkWeeks,
      timeToTargetDays: roundedTimeToTargetDays,
      estimatedDurationMin,
      surgeonId,
      procedureName,
      inpatient,
      unavailableUntil: unavailableUntil || undefined,
      flags,
    });
  }

  if (!normalized.includes("source_key") && !normalized.includes("case_num")) {
    warnings.push("No source_key or case_num column found; generated row-based keys.");
  }

  return { cases, warnings };
}

export function getCsvTemplate(): string {
  return [
    "source_key,benchmark,time_to_target_days,estimated_duration_min,unavailable_until,surgeon_id,procedure_name,osa,diabetes,out_of_town,high_bmi,chronic_pain,special_assist",
    "A123,2w,10,90,2026-04-15,DR001,Laparoscopic Myomectomy,yes,no,no,yes,no,no",
    "B456,6w,-4,120,,DR001,Hysteroscopy,no,yes,yes,no,yes,yes",
  ].join("\n");
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function parseBenchmarkWeeks(value: string | undefined): BenchmarkWeeks | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return null;
  let weeks = Number(match[0]);
  const hasDaysUnit = /day|days|d$/.test(normalized);
  if (hasDaysUnit || weeks > 26) {
    weeks = weeks / 7;
  }
  const allowed: BenchmarkWeeks[] = [2, 4, 6, 12, 26];
  const nearest = allowed.reduce((best, current) =>
    Math.abs(current - weeks) < Math.abs(best - weeks) ? current : best
  );
  return nearest;
}

function toNumber(value: string | undefined): number {
  if (!value) return Number.NaN;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  return Number(cleaned);
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function inferDurationFromProcedure(name: string): number {
  const normalized = name.toLowerCase();
  if (normalized.includes("hysterectomy")) {
    return 180;
  }
  if (normalized.includes("hysteroscop")) {
    return 60;
  }
  if (normalized.includes("laparoscop")) {
    return 90;
  }
  return Number.NaN;
}
