export type BenchmarkWeeks = 2 | 4 | 6 | 12 | 26;

export const clinicalFlagDefinitions = [
  { key: "osa", label: "OSA", csvColumn: "osa" },
  { key: "diabetes", label: "Diabetes", csvColumn: "diabetes" },
  { key: "outOfTown", label: "Out-of-town", csvColumn: "out_of_town" },
  { key: "highBmi", label: "High BMI", csvColumn: "high_bmi" },
  { key: "chronicPain", label: "Chronic Pain", csvColumn: "chronic_pain" },
  { key: "specialAssist", label: "Special Assist", csvColumn: "special_assist" },
] as const;

export type ClinicalFlagKey = (typeof clinicalFlagDefinitions)[number]["key"];

export type ClinicalFlags = Partial<Record<ClinicalFlagKey, boolean>> & {
  [key: string]: boolean | undefined;
};

export type PatientCase = {
  caseId: string;
  sourceKey: string;
  benchmarkWeeks: BenchmarkWeeks;
  timeToTargetDays: number;
  estimatedDurationMin: number;
  surgeonId: string;
  procedureName?: string;
  inpatient?: boolean;
  unavailableUntil?: string;
  flags: ClinicalFlags;
};

export type ScoredCase = PatientCase & {
  urgencyWeight: number;
  overdueDays: number;
  riskScore: number;
  valueScore: number;
};

export type SlateResult = {
  blockMinutes: number;
  totalMinutes: number;
  utilizationPct: number;
  totalRiskScore: number;
  utilizationWeight: number;
  selected: ScoredCase[];
  remaining: ScoredCase[];
};
