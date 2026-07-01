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
  /**
   * Opaque, non-identifying code (e.g. "C-001"). Used everywhere internally
   * (React keys, override maps, optimizer ids) and as the machine `case_id`
   * column in exports. Carries no patient information and is stable for a given
   * uploaded file.
   */
  caseId: string;
  /**
   * The raw identifier as it appeared in the uploaded file (patient name, PHN,
   * or an already-deidentified key). Only ever written to the secured
   * code->patient mapping export. Never used as a React key.
   */
  sourceKey: string;
  /** Human-readable label shown on screen to staff (may contain PHI). */
  displayLabel: string;
  /**
   * Stable patient reference (the PHN) used only in the browser to derive the
   * pseudonymized cloud-sync token. Never exported and never sent to the server.
   */
  patientRef?: string;
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
  /** Days past target (0 if not yet overdue). */
  overdueDays: number;
  /** Composite urgency + wait score (see priorityScoreOf). */
  priorityScore: number;
};

export type SlateResult = {
  /** Local calendar date (YYYY-MM-DD) this slate was optimized for. */
  dateISO: string;
  blockMinutes: number;
  /** Sum of surgical case durations only (excludes turnaround). */
  totalMinutes: number;
  /** Total turnaround time in the slate: 30 min after every case but the last. */
  turnaroundMinutes: number;
  /** Occupied time (cases + turnaround) as a percentage of the block. */
  utilizationPct: number;
  totalPriorityScore: number;
  /** Cases guaranteed onto the slate because they are over target (anchors). */
  anchoredCount: number;
  selected: ScoredCase[];
  remaining: ScoredCase[];
};
