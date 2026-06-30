"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  SyncedState,
  buildCaseTokens,
  changePassword,
  fetchState,
  loginOffice,
  logoutOffice,
  putState,
  resetPassword,
} from "../lib/sync";
import * as XLSX from "xlsx";
import {
  downloadSlatePdf,
  downloadAllSlatesPdf,
  downloadWaitlistPdf,
  SlatePdfCase,
  SlatePdfOptions,
  WaitlistPdfRow,
} from "./slatePdf";
import {
  ClinicalFlagKey,
  formatMinutesToTime,
  getBlockMinutes,
  getBlockStartMinutes,
  normalizeDateOnly,
  optimizeSlatesForDates,
  parseCsv,
  PatientCase,
  ScoredCase,
  clinicalFlagDefinitions,
  serializeCsv,
  csvEscape,
  reorderSlateByCaseIds,
  priorityScoreOf,
  toLocalDateOnly,
  encryptJson,
  decryptJson,
  isEncryptedEnvelope,
  EncryptedEnvelope,
  TURNAROUND_MINUTES,
} from "@slatebuilder/core";

type SpreadsheetRow = Record<string, string | number | boolean | null | undefined>;

type OfficeSessionState = {
  csvText: string;
  durationOverrides: Record<string, number>;
  unavailableOverrides: Record<string, string>;
  flagOverrides: Record<string, Partial<Record<ClinicalFlagKey, boolean>>>;
  removedFromSlateSuggestions: Record<string, boolean>;
  defaultDurations: {
    hysteroscopy: number;
    laparoscopy: number;
    hysterectomy: number;
    other: number;
  };
  priorityMode: "ttt" | "urgency_then_ttt";
  slateCount: number;
  slateDates: string[];
  orderedSlateCaseIds: string[][];
};

/**
 * What gets written to localStorage / exported to a file. The session state may
 * contain patient identifiers, so it is stored only as an encrypted envelope.
 * Name and savedAt are cleartext metadata so the list can render without the
 * passphrase.
 */
type StoredOfficeSession = {
  version: 2;
  id: string;
  name: string;
  savedAt: string;
  encrypted: EncryptedEnvelope;
};

type OfficeTab = "setup" | "slates" | "waitlist" | "long";
const OFFICE_TAB_KEY = "slatebuilder-office-tab";
const OFFICE_SAVED_SESSIONS_KEY = "slatebuilder-office-saved-sessions-v2";
// Autosave lives in sessionStorage (cleared when the tab closes, never shared
// with other tabs or written to disk) so unencrypted PHI is not left behind on
// a shared clinic workstation.
const OFFICE_AUTOSAVE_KEY = "slatebuilder-office-autosave";

function downloadFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeOfficeWorkbookToCsv(rows: SpreadsheetRow[]): string {
  // Office exports always express TARGET_TIME and TIME_WAITING in weeks.
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
  ];

  const lines = [headers.join(",")];

  rows.forEach((row, index) => {
    const patientName = String(row["PAT_NAME1"] ?? "").trim();
    const phn = String(row["PHN"] ?? "").trim();
    const surgeon = String(row["SURGEON"] ?? "").trim();
    const diagnosis = String(row["DIAGNOSIS"] ?? "").trim();
    const targetTime = String(row["TARGET_TIME"] ?? "").trim();
    const timeWaiting = String(row["TIME_WAITING"] ?? "").trim();

    const sourceKey = patientName || phn || `Office row ${index + 2}`;
    // patient_ref (PHN) is the stable key for cloud-sync tokens; it stays in the
    // browser and is never written to slate/mapping/priority exports.
    const values = [
      sourceKey,
      phn,
      targetTime,
      timeWaiting,
      "",
      "",
      surgeon,
      diagnosis,
      ...clinicalFlagDefinitions.map(() => ""),
    ];
    lines.push(values.map((value) => csvEscape(value)).join(","));
  });

  return lines.join("\n");
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-sand-200 bg-white/80 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-sand-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slateBlue-900">{value}</p>
      <p className="mt-1 text-xs text-sand-700">{detail}</p>
    </div>
  );
}

// Urgency tint keyed by benchmark class (most urgent = red).
function urgencyChipClasses(weeks: number): string {
  if (weeks <= 2) return "bg-rose-100 text-rose-700";
  if (weeks <= 4) return "bg-orange-100 text-orange-700";
  if (weeks <= 6) return "bg-amber-100 text-amber-800";
  if (weeks <= 12) return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

function UrgencyBadge({
  benchmarkWeeks,
  timeToTargetDays,
}: {
  benchmarkWeeks: number;
  timeToTargetDays: number;
}) {
  const overdue = timeToTargetDays < 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${urgencyChipClasses(
          benchmarkWeeks
        )}`}
      >
        {benchmarkWeeks}w
      </span>
      {overdue && (
        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">
          {Math.abs(timeToTargetDays)}d overdue
        </span>
      )}
    </span>
  );
}

// Capacity meter: green under target, amber as it fills, red when over the block.
function CapacityBar({ totalMinutes, blockMinutes }: { totalMinutes: number; blockMinutes: number }) {
  const pct = blockMinutes > 0 ? (totalMinutes / blockMinutes) * 100 : 0;
  const over = totalMinutes > blockMinutes;
  const remaining = blockMinutes - totalMinutes;
  const barColor = over ? "bg-rose-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-sand-700">
        <span className="font-semibold text-sand-900">Capacity</span>
        <span className={over ? "font-semibold text-rose-600" : ""}>
          {over
            ? `Over by ${Math.abs(remaining)} min`
            : remaining === 0
              ? "Full"
              : `${remaining} min free`}
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-sand-200">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(pct, totalMinutes > 0 ? 4 : 0))}%` }}
        />
      </div>
    </div>
  );
}

type OverviewBucket = {
  label: string;
  wellUnder: number; // > 50% below target wait (lots of slack)
  approaching: number; // within 50% of target
  recentlyOver: number; // overdue by up to 50% of target
  wellOver: number; // overdue by more than 50% of target
  total: number;
};

const OVERVIEW_SEGMENTS = [
  { key: "wellUnder", color: "#a7f3d0", label: ">50% below target" },
  { key: "approaching", color: "#34d399", label: "≤50% below target" },
  { key: "recentlyOver", color: "#f59e0b", label: "≤50% overdue" },
  { key: "wellOver", color: "#e11d48", label: ">50% overdue" },
] as const;

// Stacked histogram: one bar per benchmark bucket, split into under/over-target
// bands. Pure SVG so no charting dependency is needed.
function WaitlistHistogram({ buckets }: { buckets: OverviewBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const W = 320;
  const H = 188;
  const padL = 8;
  const padR = 8;
  const padTop = 14;
  const axis = 30;
  const chartH = H - padTop - axis;
  const innerW = W - padL - padR;
  const slot = innerW / buckets.length;
  const barW = Math.min(42, slot * 0.6);
  const baseline = padTop + chartH;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Waitlist overview by benchmark bucket"
    >
      <line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke="#e7d3b2" strokeWidth="1" />
      {buckets.map((b, i) => {
        const cx = padL + slot * i + slot / 2;
        const x = cx - barW / 2;
        let cursor = baseline;
        return (
          <g key={b.label}>
            {OVERVIEW_SEGMENTS.map((seg) => {
              const count = b[seg.key];
              if (count <= 0) return null;
              const h = (count / max) * chartH;
              cursor -= h;
              return (
                <rect key={seg.key} x={x} y={cursor} width={barW} height={h} fill={seg.color} />
              );
            })}
            {b.total > 0 && (
              <text
                x={cx}
                y={baseline - (b.total / max) * chartH - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#7b4724"
              >
                {b.total}
              </text>
            )}
            <text
              x={cx}
              y={baseline + 15}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="#512f1c"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Home() {
  const [csvText, setCsvText] = useState("");
  const [cases, setCases] = useState<PatientCase[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [unavailableOverrides, setUnavailableOverrides] = useState<Record<string, string>>({});
  const [flagOverrides, setFlagOverrides] = useState<
    Record<string, Partial<Record<ClinicalFlagKey, boolean>>>
  >({});
  const [removedFromSlateSuggestions, setRemovedFromSlateSuggestions] = useState<
    Record<string, boolean>
  >({});
  const [defaultDurations, setDefaultDurations] = useState({
    hysteroscopy: 30,
    laparoscopy: 60,
    hysterectomy: 180,
    other: 90,
  });
  const [defaultsSavedAt, setDefaultsSavedAt] = useState<string | null>(null);
  const [priorityMode, setPriorityMode] = useState<"ttt" | "urgency_then_ttt">(
    "urgency_then_ttt"
  );
  const [slateCount, setSlateCount] = useState(2);
  const [slateDates, setSlateDates] = useState<string[]>(() => {
    const today = new Date();
    return [0, 7, 14].map((offset) => {
      const next = new Date(today);
      next.setDate(today.getDate() + offset);
      return next.toISOString().slice(0, 10);
    });
  });
  const [orderedSlates, setOrderedSlates] = useState<ScoredCase[][]>([]);
  const [dragState, setDragState] = useState<{ slateIndex: number; caseId: string } | null>(
    null
  );
  const [orderedSlateCaseIds, setOrderedSlateCaseIds] = useState<string[][]>([]);
  const [savedSessions, setSavedSessions] = useState<StoredOfficeSession[]>([]);
  const [sessionName, setSessionName] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [includeNamesInExports, setIncludeNamesInExports] = useState(false);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OfficeTab>("setup");
  const [expandedCaseIds, setExpandedCaseIds] = useState<Record<string, boolean>>({});
  const [waitlistQuery, setWaitlistQuery] = useState("");
  const [waitlistOverdueOnly, setWaitlistOverdueOnly] = useState(false);
  const [waitlistUnslatedOnly, setWaitlistUnslatedOnly] = useState(false);
  // Cloud sync (pseudonymized): officeKey lives only in memory.
  const [officeIdInput, setOfficeIdInput] = useState("");
  const [officePassword, setOfficePassword] = useState("");
  const [officeKey, setOfficeKey] = useState<Uint8Array | null>(null);
  const [signedInId, setSignedInId] = useState<string | null>(null);
  const [caseTokens, setCaseTokens] = useState<Record<string, string>>({});
  const [planStatus, setPlanStatus] = useState<"draft" | "finalized">("draft");
  const [authBusy, setAuthBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [showReset, setShowReset] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const syncVersionRef = useRef(0);
  const lastSyncedJsonRef = useRef<string>("");
  const tokensReadyRef = useRef(false);

  useEffect(() => {
    if (!csvText) return;
    const result = parseCsv(csvText);
    setCases(result.cases);
    setWarnings(result.warnings);
  }, [csvText]);

  useEffect(() => {
    const stored = window.localStorage.getItem("slatebuilder-office-default-durations");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<typeof defaultDurations>;
      setDefaultDurations((prev) => ({
        ...prev,
        ...parsed,
      }));
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    const storedSessions = window.localStorage.getItem(OFFICE_SAVED_SESSIONS_KEY);
    if (storedSessions) {
      try {
        setSavedSessions(JSON.parse(storedSessions) as StoredOfficeSession[]);
      } catch {
        // ignore malformed saved sessions
      }
    }
  }, []);

  // Restore the in-tab autosave (sessionStorage only) so a reload within the
  // same tab does not lose work. Nothing is read from disk.
  useEffect(() => {
    const auto = window.sessionStorage.getItem(OFFICE_AUTOSAVE_KEY);
    if (!auto) return;
    try {
      const state = JSON.parse(auto) as OfficeSessionState;
      applySessionState(state, false);
    } catch {
      // ignore malformed autosave
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the last-viewed tab for this browser tab.
  useEffect(() => {
    const t = window.sessionStorage.getItem(OFFICE_TAB_KEY);
    if (t === "setup" || t === "slates" || t === "waitlist" || t === "long") {
      setActiveTab(t);
    }
  }, []);
  useEffect(() => {
    window.sessionStorage.setItem(OFFICE_TAB_KEY, activeTab);
  }, [activeTab]);

  const applyDefaultDuration = (item: PatientCase): PatientCase => {
    const name = (item.procedureName ?? "").toLowerCase();
    let duration = defaultDurations.other;
    if (name.includes("hysterectomy")) {
      duration = defaultDurations.hysterectomy;
    } else if (name.includes("hysteroscop")) {
      duration = defaultDurations.hysteroscopy;
    } else if (name.includes("laparoscop")) {
      duration = defaultDurations.laparoscopy;
    }
    return { ...item, estimatedDurationMin: duration };
  };

  const applyFlagOverrides = (item: PatientCase): PatientCase => {
    const override = flagOverrides[item.caseId];
    if (!override) return item;
    return {
      ...item,
      flags: {
        ...item.flags,
        ...override,
      },
    };
  };

  const applyUnavailableOverrides = (item: PatientCase): PatientCase => {
    const override = unavailableOverrides[item.caseId];
    if (override === undefined) return item;
    return {
      ...item,
      unavailableUntil: normalizeDateOnly(override),
    };
  };

  const officeCases = useMemo(() => {
    return cases.map((item) =>
      applyUnavailableOverrides(applyFlagOverrides(applyDefaultDuration(item)))
    );
  }, [cases, defaultDurations, flagOverrides, unavailableOverrides]);

  const officeCasesWithOverrides = useMemo(() => {
    if (Object.keys(durationOverrides).length === 0) return officeCases;
    return officeCases.map((item) => {
      const override = durationOverrides[item.caseId];
      if (!override) return item;
      return { ...item, estimatedDurationMin: override };
    });
  }, [officeCases, durationOverrides]);

  const slateEligibleCases = useMemo(() => {
    return officeCasesWithOverrides.filter((item) => !removedFromSlateSuggestions[item.caseId]);
  }, [officeCasesWithOverrides, removedFromSlateSuggestions]);

  const officeSurgeons = useMemo(() => {
    return Array.from(new Set(officeCases.map((item) => item.surgeonId))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [officeCases]);

  const sortForWaitlist = (items: PatientCase[]) => {
    return [...items].sort((a, b) => {
      if (priorityMode === "ttt") {
        return a.timeToTargetDays - b.timeToTargetDays;
      }
      // Composite priority (same score the slate uses), longest wait breaks ties.
      const diff = priorityScoreOf(b) - priorityScoreOf(a);
      if (diff !== 0) return diff;
      return a.timeToTargetDays - b.timeToTargetDays;
    });
  };

  const sortForSlate = (items: ScoredCase[]) => {
    const order = [2, 4, 6, 12, 26];
    return [...items].sort((a, b) => {
      const aFlag = a.flags?.diabetes ? 0 : a.flags?.osa ? 1 : 2;
      const bFlag = b.flags?.diabetes ? 0 : b.flags?.osa ? 1 : 2;
      if (aFlag !== bFlag) return aFlag - bFlag;
      if (priorityMode === "ttt") {
        return a.timeToTargetDays - b.timeToTargetDays;
      }
      const aGroup = order.indexOf(a.benchmarkWeeks);
      const bGroup = order.indexOf(b.benchmarkWeeks);
      if (aGroup !== bGroup) return aGroup - bGroup;
      return a.timeToTargetDays - b.timeToTargetDays;
    });
  };

  const slates = useMemo(() => {
    if (slateEligibleCases.length === 0) return null;
    const dates = slateDates
      .slice(0, slateCount)
      .filter(Boolean)
      .map((date) => new Date(`${date}T00:00:00`));
    if (dates.length === 0) return null;
    return optimizeSlatesForDates(slateEligibleCases, dates);
  }, [slateEligibleCases, slateDates, slateCount]);

  useEffect(() => {
    if (!slates) {
      setOrderedSlates([]);
      setOrderedSlateCaseIds([]);
      return;
    }
    const nextOrdered = slates.map((item, index) =>
      reorderSlateByCaseIds(sortForSlate(item.selected), orderedSlateCaseIds[index])
    );
    setOrderedSlates(nextOrdered);
    setOrderedSlateCaseIds(nextOrdered.map((slate) => slate.map((item) => item.caseId)));
    // orderedSlateCaseIds is read only to preserve prior manual ordering; it is
    // the value we write here, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slates, priorityMode]);

  const selectedCaseIds = useMemo(() => {
    const ids = new Set<string>();
    orderedSlates.forEach((slate) => {
      slate.forEach((item) => ids.add(item.caseId));
    });
    return ids;
  }, [orderedSlates]);

  const orderedByUrgency = useMemo(() => {
    return sortForWaitlist(officeCasesWithOverrides);
  }, [officeCasesWithOverrides, priorityMode]);

  const remainingByUrgency = useMemo(() => {
    return orderedByUrgency.filter((item) => !selectedCaseIds.has(item.caseId));
  }, [orderedByUrgency, selectedCaseIds]);

  const blockMinutes = useMemo(() => {
    if (!slateDates[0]) return 0;
    const date = new Date(`${slateDates[0]}T00:00:00`);
    return getBlockMinutes(date);
  }, [slateDates]);

  const officeStats = useMemo(() => {
    const overdue = officeCasesWithOverrides.filter((item) => item.timeToTargetDays < 0).length;
    const totalMinutes = officeCasesWithOverrides.reduce(
      (sum, item) => sum + item.estimatedDurationMin,
      0
    );
    const urgent = officeCasesWithOverrides.filter((item) => item.benchmarkWeeks <= 6).length;
    return {
      totalCases: officeCasesWithOverrides.length,
      overdue,
      urgent,
      totalHours: totalMinutes / 60,
    };
  }, [officeCasesWithOverrides]);

  // Histogram data: per benchmark bucket, split patients into under-/over-target
  // bands at the ±50%-of-target threshold.
  const waitlistOverview = useMemo<OverviewBucket[]>(() => {
    const order = [2, 4, 6, 12, 26] as const;
    const buckets: OverviewBucket[] = order.map((weeks) => ({
      label: `${weeks}w`,
      wellUnder: 0,
      approaching: 0,
      recentlyOver: 0,
      wellOver: 0,
      total: 0,
    }));
    const indexOf = new Map(order.map((weeks, i) => [weeks, i]));
    officeCasesWithOverrides.forEach((item) => {
      const i = indexOf.get(item.benchmarkWeeks);
      if (i === undefined) return;
      const bucket = buckets[i];
      const target = item.benchmarkWeeks * 7;
      const ttt = item.timeToTargetDays;
      if (ttt >= 0) {
        if (ttt > 0.5 * target) bucket.wellUnder += 1;
        else bucket.approaching += 1;
      } else {
        const overdue = -ttt;
        if (overdue > 0.5 * target) bucket.wellOver += 1;
        else bucket.recentlyOver += 1;
      }
      bucket.total += 1;
    });
    return buckets;
  }, [officeCasesWithOverrides]);

  // Long-waiters: every case past target, grouped by benchmark class, most
  // overdue first within each class.
  const longWaiters = useMemo(() => {
    const order = [2, 4, 6, 12, 26] as const;
    const groups = order.map((weeks) => ({
      weeks,
      label: `${weeks}w`,
      cases: [] as PatientCase[],
    }));
    const indexOf = new Map(order.map((weeks, i) => [weeks, i]));
    officeCasesWithOverrides
      .filter((c) => c.timeToTargetDays < 0)
      .forEach((c) => {
        const i = indexOf.get(c.benchmarkWeeks);
        if (i !== undefined) groups[i].cases.push(c);
      });
    groups.forEach((g) => g.cases.sort((a, b) => a.timeToTargetDays - b.timeToTargetDays));
    const total = groups.reduce((sum, g) => sum + g.cases.length, 0);
    return { groups, total };
  }, [officeCasesWithOverrides]);

  // ---- Cloud sync (token-keyed, no PHI) ------------------------------------

  const tokenToCaseId = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(caseTokens).forEach(([caseId, token]) => {
      map[token] = caseId;
    });
    return map;
  }, [caseTokens]);

  // Recompute patient tokens whenever the office key or the uploaded cases change.
  useEffect(() => {
    if (!officeKey || cases.length === 0) {
      setCaseTokens({});
      tokensReadyRef.current = false;
      return;
    }
    let cancelled = false;
    buildCaseTokens(officeKey, cases).then((map) => {
      if (!cancelled) {
        setCaseTokens(map);
        tokensReadyRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [officeKey, cases]);

  const buildSyncedState = (): SyncedState => {
    const patientState: SyncedState["patientState"] = {};
    Object.entries(caseTokens).forEach(([caseId, token]) => {
      const entry: SyncedState["patientState"][string] = {};
      if (unavailableOverrides[caseId]) entry.unavailableUntil = unavailableOverrides[caseId];
      if (durationOverrides[caseId]) entry.durationOverrideMin = durationOverrides[caseId];
      if (flagOverrides[caseId]) entry.flagOverrides = flagOverrides[caseId];
      if (removedFromSlateSuggestions[caseId]) entry.removed = true;
      if (Object.keys(entry).length > 0) patientState[token] = entry;
    });
    const activeDates = slateDates.slice(0, slateCount);
    const assignments: Record<string, string[]> = {};
    activeDates.forEach((date, i) => {
      assignments[date] = (orderedSlateCaseIds[i] ?? [])
        .map((caseId) => caseTokens[caseId])
        .filter(Boolean);
    });
    return {
      v: 1,
      patientState,
      plan: { status: planStatus, slateDates: activeDates, assignments, updatedAt: new Date().toISOString() },
      settings: { defaultDurations, priorityMode, slateCount },
    };
  };

  const applySyncedState = (state: SyncedState, t2c: Record<string, string>) => {
    setDefaultDurations(state.settings.defaultDurations);
    setPriorityMode(state.settings.priorityMode);
    setSlateCount(state.settings.slateCount || 2);
    setPlanStatus(state.plan.status);

    const dur: Record<string, number> = {};
    const unavail: Record<string, string> = {};
    const flags: Record<string, Partial<Record<ClinicalFlagKey, boolean>>> = {};
    const removed: Record<string, boolean> = {};
    Object.entries(state.patientState).forEach(([token, ps]) => {
      const caseId = t2c[token];
      if (!caseId) return;
      if (ps.unavailableUntil) unavail[caseId] = ps.unavailableUntil;
      if (ps.durationOverrideMin) dur[caseId] = ps.durationOverrideMin;
      if (ps.flagOverrides) flags[caseId] = ps.flagOverrides;
      if (ps.removed) removed[caseId] = true;
    });
    setDurationOverrides(dur);
    setUnavailableOverrides(unavail);
    setFlagOverrides(flags);
    setRemovedFromSlateSuggestions(removed);
    if (state.plan.slateDates.length > 0) setSlateDates(state.plan.slateDates);
    setOrderedSlateCaseIds(
      state.plan.slateDates.map((date) =>
        (state.plan.assignments[date] ?? []).map((token) => t2c[token]).filter(Boolean)
      )
    );
    lastSyncedJsonRef.current = JSON.stringify(state);
  };

  const loadFromCloud = async (key: Uint8Array, t2c: Record<string, string>) => {
    const { state, version } = await fetchState(key);
    syncVersionRef.current = version;
    applySyncedState(state, t2c);
    setSyncStatus(`Synced · v${version} · ${state.plan.status}`);
  };

  const handleReset = async () => {
    const id = officeIdInput.trim().toLowerCase();
    if (!id || !recoveryCodeInput.trim() || newPassword.length < 8) {
      setSyncStatus("Enter office, recovery code, and an 8+ character new password.");
      return;
    }
    setAuthBusy(true);
    try {
      const key = await resetPassword(id, recoveryCodeInput, newPassword);
      setOfficeKey(key);
      setSignedInId(id);
      setRecoveryCodeInput("");
      setNewPassword("");
      setOfficePassword("");
      setShowReset(false);
      lastSyncedJsonRef.current = "";
      setSyncStatus("Password reset · signed in · loading…");
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (!officeKey || newPassword.length < 8) {
      setSyncStatus("Enter an 8+ character new password.");
      return;
    }
    setAuthBusy(true);
    try {
      await changePassword(officeKey, officePassword, newPassword);
      setOfficePassword("");
      setNewPassword("");
      setShowChangePw(false);
      setSyncStatus("Password changed");
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogin = async () => {
    const id = officeIdInput.trim().toLowerCase();
    if (!id || !officePassword) {
      setSyncStatus("Enter your office name and password.");
      return;
    }
    setAuthBusy(true);
    try {
      const key = await loginOffice(id, officePassword);
      setOfficeKey(key);
      setSignedInId(id);
      setOfficePassword("");
      setSyncStatus("Signed in · loading…");
      // State is applied once tokens are ready (see effect below).
    } catch (e) {
      setSyncStatus(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await logoutOffice();
    setOfficeKey(null);
    setSignedInId(null);
    setCaseTokens({});
    syncVersionRef.current = 0;
    lastSyncedJsonRef.current = "";
    setSyncStatus("Signed out");
  };

  // Once signed in and tokens are computed, pull the office's cloud state.
  useEffect(() => {
    if (!officeKey || !signedInId || Object.keys(caseTokens).length === 0) return;
    if (lastSyncedJsonRef.current) return; // already loaded this session
    loadFromCloud(officeKey, tokenToCaseId).catch(() => setSyncStatus("Could not load cloud state."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeKey, signedInId, caseTokens]);

  // Debounced auto-save of the (non-PHI) working state. A dirty check on the
  // serialized state prevents save loops; version refs drive optimistic concurrency.
  useEffect(() => {
    if (!officeKey || !signedInId || Object.keys(caseTokens).length === 0) return;
    const handle = setTimeout(async () => {
      const next = buildSyncedState();
      const json = JSON.stringify(next);
      if (json === lastSyncedJsonRef.current) return;
      setSyncStatus("Saving…");
      try {
        const result = await putState(officeKey, next, syncVersionRef.current);
        if ("conflict" in result) {
          const { state, version } = await fetchState(officeKey);
          syncVersionRef.current = version;
          applySyncedState(state, tokenToCaseId);
          setSyncStatus("Loaded a newer version from another device");
        } else {
          syncVersionRef.current = result.version;
          lastSyncedJsonRef.current = json;
          setSyncStatus(`Synced · v${result.version} · ${next.plan.status}`);
        }
      } catch {
        setSyncStatus("Offline — changes not synced");
      }
    }, 1200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    officeKey,
    signedInId,
    caseTokens,
    unavailableOverrides,
    durationOverrides,
    flagOverrides,
    removedFromSlateSuggestions,
    slateDates,
    slateCount,
    orderedSlateCaseIds,
    defaultDurations,
    priorityMode,
    planStatus,
  ]);

  const updateSlateDate = (index: number, value: string) => {
    setSlateDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const resetWorkspace = () => {
    if (
      (csvText || cases.length > 0) &&
      !window.confirm("Clear the current workspace? Unsaved changes in this tab will be lost.")
    ) {
      return;
    }
    setCsvText("");
    setCases([]);
    setWarnings([]);
    setDurationOverrides({});
    setUnavailableOverrides({});
    setFlagOverrides({});
    setRemovedFromSlateSuggestions({});
    setPriorityMode("urgency_then_ttt");
    setSlateCount(2);
    setSlateDates(() => {
      const today = new Date();
      return [0, 7, 14].map((offset) => {
        const next = new Date(today);
        next.setDate(today.getDate() + offset);
        return next.toISOString().slice(0, 10);
      });
    });
    setOrderedSlates([]);
    setOrderedSlateCaseIds([]);
    setDragState(null);
    setSessionName("");
    window.sessionStorage.removeItem(OFFICE_AUTOSAVE_KEY);
    setLastAutosaveAt(null);
    setSaveStatus("Workspace reset");
  };

  function buildSessionState(): OfficeSessionState {
    return {
      csvText,
      durationOverrides,
      unavailableOverrides,
      flagOverrides,
      removedFromSlateSuggestions,
      defaultDurations,
      priorityMode,
      slateCount,
      slateDates,
      orderedSlateCaseIds,
    };
  }

  function applySessionState(state: OfficeSessionState, persistMessage = true, name?: string) {
    setCsvText(state.csvText);
    setDurationOverrides(state.durationOverrides ?? {});
    setUnavailableOverrides(state.unavailableOverrides ?? {});
    setFlagOverrides(state.flagOverrides ?? {});
    setRemovedFromSlateSuggestions(state.removedFromSlateSuggestions ?? {});
    setDefaultDurations(state.defaultDurations);
    setPriorityMode(state.priorityMode);
    setSlateCount(state.slateCount);
    setSlateDates(state.slateDates);
    setOrderedSlateCaseIds(state.orderedSlateCaseIds ?? []);
    if (name !== undefined) setSessionName(name);
    if (persistMessage && name !== undefined) {
      setSaveStatus(`Loaded "${name}"`);
    }
  }

  function persistSavedSessions(nextSessions: StoredOfficeSession[]) {
    setSavedSessions(nextSessions);
    window.localStorage.setItem(OFFICE_SAVED_SESSIONS_KEY, JSON.stringify(nextSessions));
  }

  function requirePassphrase(): string | null {
    const pass = passphrase.trim();
    if (!pass) {
      setSaveStatus("Enter a passphrase first — it locks and unlocks saved work.");
      return null;
    }
    return pass;
  }

  const saveSession = async (nameOverride?: string) => {
    const pass = requirePassphrase();
    if (!pass) return;
    const trimmedName = (nameOverride ?? sessionName).trim() || "Office Session";
    const existing = savedSessions.find((session) => session.name === trimmedName);
    try {
      const encrypted = await encryptJson(pass, buildSessionState());
      const nextSession: StoredOfficeSession = {
        version: 2,
        id: existing?.id ?? `${Date.now()}`,
        name: trimmedName,
        savedAt: new Date().toISOString(),
        encrypted,
      };
      const nextSessions = [
        nextSession,
        ...savedSessions.filter((session) => session.id !== nextSession.id),
      ];
      persistSavedSessions(nextSessions);
      setSessionName(trimmedName);
      setSaveStatus(`Saved "${trimmedName}" (encrypted)`);
    } catch {
      setSaveStatus("Could not encrypt and save session");
    }
  };

  const loadSession = async (session: StoredOfficeSession) => {
    const pass = requirePassphrase();
    if (!pass) return;
    try {
      const state = await decryptJson<OfficeSessionState>(pass, session.encrypted);
      applySessionState(state, true, session.name);
    } catch {
      setSaveStatus(`Wrong passphrase for "${session.name}", or the data is corrupt.`);
    }
  };

  const deleteSession = (id: string) => {
    const nextSessions = savedSessions.filter((session) => session.id !== id);
    persistSavedSessions(nextSessions);
    setSaveStatus("Deleted saved session");
  };

  const clearAllSavedData = () => {
    if (
      !window.confirm(
        "Delete ALL saved sessions and autosave from this browser? This cannot be undone."
      )
    ) {
      return;
    }
    window.localStorage.removeItem(OFFICE_SAVED_SESSIONS_KEY);
    window.sessionStorage.removeItem(OFFICE_AUTOSAVE_KEY);
    setSavedSessions([]);
    setLastAutosaveAt(null);
    setSaveStatus("Cleared all saved sessions and autosave from this browser");
  };

  const exportSession = async () => {
    const pass = requirePassphrase();
    if (!pass) return;
    const trimmedName = sessionName.trim() || "office-session";
    try {
      const encrypted = await encryptJson(pass, buildSessionState());
      const payload: StoredOfficeSession = {
        version: 2,
        id: `${Date.now()}`,
        name: trimmedName,
        savedAt: new Date().toISOString(),
        encrypted,
      };
      downloadJson(`${trimmedName.replace(/\s+/g, "-").toLowerCase()}.json`, payload);
      setSaveStatus(`Exported "${trimmedName}" (encrypted)`);
    } catch {
      setSaveStatus("Could not encrypt and export session");
    }
  };

  // Autosave to sessionStorage only: it survives an in-tab reload but is cleared
  // when the tab closes and is never written to disk, so unencrypted PHI is not
  // left on a shared workstation.
  useEffect(() => {
    if (!csvText && cases.length === 0) return;
    window.sessionStorage.setItem(OFFICE_AUTOSAVE_KEY, JSON.stringify(buildSessionState()));
    setLastAutosaveAt(new Date().toLocaleTimeString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    csvText,
    cases.length,
    durationOverrides,
    unavailableOverrides,
    flagOverrides,
    removedFromSlateSuggestions,
    defaultDurations,
    priorityMode,
    slateCount,
    slateDates,
    orderedSlateCaseIds,
  ]);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result;
        if (!(buffer instanceof ArrayBuffer)) return;
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        if (!sheet) {
          setCsvText("");
          setWarnings(["No worksheet found in the uploaded Excel file."]);
          return;
        }
        const rows = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, {
          defval: "",
          raw: false,
        });
        setCsvText(normalizeOfficeWorkbookToCsv(rows));
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
    };
    reader.readAsText(file);
  };

  const handleImportSession = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const parsed = JSON.parse(text) as StoredOfficeSession;
        if (!isEncryptedEnvelope(parsed.encrypted)) {
          setSaveStatus("Unrecognized or unencrypted session file");
          return;
        }
        const pass = requirePassphrase();
        if (!pass) return;
        const state = await decryptJson<OfficeSessionState>(pass, parsed.encrypted);
        applySessionState(state, true, parsed.name);
      } catch {
        setSaveStatus("Could not import session — wrong passphrase or invalid file");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleDragStart = (slateIndex: number, caseId: string) => {
    setDragState({ slateIndex, caseId });
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    slateIndex: number,
    caseId: string
  ) => {
    event.preventDefault();
    if (!dragState || dragState.caseId === caseId || dragState.slateIndex !== slateIndex) {
      return;
    }
    setOrderedSlates((prev) => {
      const next = prev.map((slate) => [...slate]);
      const slate = next[slateIndex];
      if (!slate) return prev;
      const fromIndex = slate.findIndex((item) => item.caseId === dragState.caseId);
      const toIndex = slate.findIndex((item) => item.caseId === caseId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = slate.splice(fromIndex, 1);
      slate.splice(toIndex, 0, moved);
      setOrderedSlateCaseIds(next.map((ordered) => ordered.map((item) => item.caseId)));
      return next;
    });
  };

  const updateDuration = (slateIndex: number, caseId: string, value: string) => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    setDurationOverrides((prev) => ({ ...prev, [caseId]: minutes }));
    setOrderedSlates((prev) => {
      const next = prev.map((slate) => [...slate]);
      const slate = next[slateIndex];
      if (!slate) return prev;
      const idx = slate.findIndex((item) => item.caseId === caseId);
      if (idx < 0) return prev;
      slate[idx] = { ...slate[idx], estimatedDurationMin: minutes };
      setOrderedSlateCaseIds(next.map((ordered) => ordered.map((item) => item.caseId)));
      return next;
    });
  };

  const updateFlag = (caseId: string, flag: ClinicalFlagKey, value: boolean) => {
    setFlagOverrides((prev) => ({
      ...prev,
      [caseId]: {
        ...prev[caseId],
        [flag]: value,
      },
    }));
  };

  const updateUnavailableUntil = (caseId: string, value: string) => {
    setUnavailableOverrides((prev) => ({
      ...prev,
      [caseId]: value,
    }));
  };

  const removeFromSuggestedSlates = (caseId: string) => {
    setRemovedFromSlateSuggestions((prev) => ({
      ...prev,
      [caseId]: true,
    }));
  };

  const restoreToSuggestedSlates = (caseId: string) => {
    setRemovedFromSlateSuggestions((prev) => {
      const next = { ...prev };
      delete next[caseId];
      return next;
    });
  };

  const resetDurationOverrides = () => {
    setDurationOverrides({});
    if (!slates) return;
    const nextOrdered = slates.map((item) => sortForSlate(item.selected));
    setOrderedSlates(nextOrdered);
    setOrderedSlateCaseIds(nextOrdered.map((slate) => slate.map((item) => item.caseId)));
  };

  const saveDefaultDurations = () => {
    window.localStorage.setItem(
      "slatebuilder-office-default-durations",
      JSON.stringify(defaultDurations)
    );
    setDefaultsSavedAt(new Date().toLocaleTimeString());
  };

  const buildSchedule = (items: ScoredCase[], dateISO: string) => {
    const date = new Date(`${dateISO}T00:00:00`);
    let cursor = getBlockStartMinutes(date);
    return items.map((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      cursor = end;
      // Every case but the last is followed by a 30-min turnaround.
      const tatAfter = index < items.length - 1;
      const tatStart = end;
      const tatEnd = tatAfter ? end + TURNAROUND_MINUTES : end;
      if (tatAfter) cursor = tatEnd;
      return { item, start, end, tatAfter, tatStart, tatEnd };
    });
  };

  const downloadSlateCsv = (slateIndex: number) => {
    if (!slates || !orderedSlates[slateIndex]) return;
    const orderedSlate = orderedSlates[slateIndex];
    const dateISO = slates[slateIndex].dateISO;
    const date = new Date(`${dateISO}T00:00:00`);
    const startMinutes = getBlockStartMinutes(date);
    const rows = [
      [
        "order",
        "case_id",
        ...(includeNamesInExports ? ["patient_label"] : []),
        "start_time",
        "end_time",
        "turnaround_after_min",
        "patient_type",
        "procedure_name",
        "benchmark_weeks",
        "time_to_target_days",
        "estimated_duration_min",
        "unavailable_until",
        "surgeon_id",
        ...clinicalFlagDefinitions.map((flag) => flag.csvColumn),
        "priority_score",
      ],
    ];

    let cursor = startMinutes;
    orderedSlate.forEach((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      const tatAfter = index < orderedSlate.length - 1;
      cursor = end + (tatAfter ? TURNAROUND_MINUTES : 0);
      rows.push([
        String(index + 1),
        item.caseId,
        ...(includeNamesInExports ? [item.displayLabel] : []),
        formatMinutesToTime(start),
        formatMinutesToTime(end),
        tatAfter ? String(TURNAROUND_MINUTES) : "0",
        item.inpatient ? "Inpatient" : "Day Case",
        item.procedureName ?? "",
        String(item.benchmarkWeeks),
        String(item.timeToTargetDays),
        String(item.estimatedDurationMin),
        item.unavailableUntil ?? "",
        item.surgeonId,
        ...clinicalFlagDefinitions.map((flag) => (item.flags?.[flag.key] ? "yes" : "no")),
        item.priorityScore.toFixed(2),
      ]);
    });

    const csv = serializeCsv(rows);
    downloadFile(`office_slate_${dateISO}_${slateIndex + 1}.csv`, csv);
  };

  // The surgeon name comes from the uploaded waitlist's SURGEON field
  // (parsed into surgeonId); offices do not type it in.
  const surgeonNameFor = (slate: { surgeonId: string }[]): string => {
    const unique = Array.from(new Set(slate.map((item) => item.surgeonId)));
    return unique.join(", ") || "Surgeon";
  };

  const fileSlug = (value: string): string =>
    value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "surgeon";

  const buildSlateOptions = (slateIndex: number): SlatePdfOptions | null => {
    const orderedSlate = orderedSlates[slateIndex];
    if (!orderedSlate || orderedSlate.length === 0 || !slates) return null;
    const dateISO = slates[slateIndex].dateISO;
    const date = new Date(`${dateISO}T00:00:00`);
    const startMin = getBlockStartMinutes(date);
    const blockMin = getBlockMinutes(date);

    let cursor = startMin;
    const pdfCases: SlatePdfCase[] = orderedSlate.map((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      const tatAfter = index < orderedSlate.length - 1;
      cursor = end + (tatAfter ? TURNAROUND_MINUTES : 0);
      return {
        order: index + 1,
        startLabel: formatMinutesToTime(start),
        endLabel: formatMinutesToTime(end),
        durationMin: Math.round(item.estimatedDurationMin),
        tatAfter,
        benchmarkWeeks: item.benchmarkWeeks,
        overdueDays: Math.max(0, -item.timeToTargetDays),
        primary: includeNamesInExports ? item.displayLabel : item.caseId,
        secondary: includeNamesInExports ? item.caseId : undefined,
        procedure: item.procedureName ?? "",
        flags: clinicalFlagDefinitions
          .filter((flag) => item.flags?.[flag.key])
          .map((flag) => flag.label),
        inpatient: Boolean(item.inpatient),
      };
    });

    const surgicalMin = orderedSlate.reduce(
      (sum, item) => sum + Math.round(item.estimatedDurationMin),
      0
    );
    const turnaroundMin = TURNAROUND_MINUTES * Math.max(0, orderedSlate.length - 1);
    const occupiedMin = surgicalMin + turnaroundMin;
    const utilization = blockMin > 0 ? (occupiedMin / blockMin) * 100 : 0;
    const surgeonName = surgeonNameFor(orderedSlate);
    const orDateLabel = dateISO
      ? date.toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Date not set";

    return {
      surgeonName,
      orDateLabel,
      blockLabel: `${formatMinutesToTime(startMin)}–${formatMinutesToTime(
        startMin + blockMin
      )} · ${blockMin} min · incl. ${turnaroundMin} min TAT`,
      summaryLabel: `${orderedSlate.length} ${
        orderedSlate.length === 1 ? "case" : "cases"
      } · ${utilization.toFixed(0)}% utilization`,
      cases: pdfCases,
      fileName: `slate_${fileSlug(surgeonName)}_${dateISO || "undated"}.pdf`,
    };
  };

  const downloadSlatePdfFile = (slateIndex: number) => {
    const opts = buildSlateOptions(slateIndex);
    if (opts) downloadSlatePdf(opts);
  };

  const downloadAllSlatesPdfFile = () => {
    const allOpts = (orderedSlates ?? [])
      .map((_, index) => buildSlateOptions(index))
      .filter((opts): opts is SlatePdfOptions => opts !== null);
    if (allOpts.length === 0) return;
    const surgeon = fileSlug(allOpts[0].surgeonName);
    const first = slateDates[0] || "undated";
    downloadAllSlatesPdf(allOpts, `slates_${surgeon}_${first}.pdf`);
  };

  const downloadWaitlistPdfFile = () => {
    if (orderedByUrgency.length === 0) return;
    const rows: WaitlistPdfRow[] = orderedByUrgency.map((item, index) => ({
      rank: index + 1,
      primary: includeNamesInExports ? item.displayLabel : item.caseId,
      secondary: includeNamesInExports ? item.caseId : undefined,
      procedure: item.procedureName ?? "",
      benchmarkWeeks: item.benchmarkWeeks,
      timeToTargetDays: item.timeToTargetDays,
      overdueDays: Math.max(0, -item.timeToTargetDays),
      status: selectedCaseIds.has(item.caseId) ? "Slated" : "Waiting",
    }));
    const surgeonName = surgeonNameFor(orderedByUrgency);
    const slatedCount = rows.filter((r) => r.status === "Slated").length;
    downloadWaitlistPdf({
      surgeonName,
      generatedLabel: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      summaryLabel: `${rows.length} ${rows.length === 1 ? "patient" : "patients"} · ${slatedCount} slated`,
      rows,
      fileName: `priority_waitlist_${fileSlug(surgeonName)}.pdf`,
    });
  };

  const downloadMappingCsv = (slateIndex: number) => {
    if (!orderedSlates[slateIndex] || orderedSlates[slateIndex].length === 0) return;
    const dateISO = slates?.[slateIndex]?.dateISO ?? "undated";
    // The reidentification key: opaque code -> patient label. Keep this file
    // secured and separate from the deidentified slate CSV.
    const rows = [["case_id", "patient_label"]];
    orderedSlates[slateIndex].forEach((item) => rows.push([item.caseId, item.displayLabel]));
    const csv = serializeCsv(rows);
    downloadFile(`CONFIDENTIAL_office_case_mapping_${dateISO}_${slateIndex + 1}.csv`, csv);
  };

  const downloadPriorityCsv = () => {
    if (orderedByUrgency.length === 0) return;
    const rows = [
      [
        "order",
        "case_id",
        ...(includeNamesInExports ? ["patient_label"] : []),
        "status",
        "patient_type",
        "benchmark_weeks",
        "time_to_target_days",
        "estimated_duration_min",
        "unavailable_until",
        "surgeon_id",
        "procedure_name",
        "removed_from_slate_suggestions",
        ...clinicalFlagDefinitions.map((flag) => flag.csvColumn),
      ],
    ];
    orderedByUrgency.forEach((item, index) => {
      rows.push([
        String(index + 1),
        item.caseId,
        ...(includeNamesInExports ? [item.displayLabel] : []),
        selectedCaseIds.has(item.caseId) ? "Slated" : "Waiting",
        item.inpatient ? "Inpatient" : "Day Case",
        String(item.benchmarkWeeks),
        String(item.timeToTargetDays),
        String(item.estimatedDurationMin),
        item.unavailableUntil ?? "",
        item.surgeonId,
        item.procedureName ?? "",
        removedFromSlateSuggestions[item.caseId] ? "yes" : "no",
        ...clinicalFlagDefinitions.map((flag) => (item.flags?.[flag.key] ? "yes" : "no")),
      ]);
    });
    const csv = serializeCsv(rows);
    downloadFile("office_priority_waitlist.csv", csv);
  };

  const downloadLongWaitersCsv = () => {
    if (longWaiters.total === 0) return;
    const rows = [
      [
        "urgency_class",
        "days_over_target",
        "case_id",
        ...(includeNamesInExports ? ["patient_label"] : []),
        "benchmark_weeks",
        "time_to_target_days",
        "surgeon_id",
        "procedure_name",
        "status",
        ...clinicalFlagDefinitions.map((flag) => flag.csvColumn),
      ],
    ];
    longWaiters.groups.forEach((group) => {
      group.cases.forEach((item) => {
        rows.push([
          group.label,
          String(Math.abs(item.timeToTargetDays)),
          item.caseId,
          ...(includeNamesInExports ? [item.displayLabel] : []),
          String(item.benchmarkWeeks),
          String(item.timeToTargetDays),
          item.surgeonId,
          item.procedureName ?? "",
          selectedCaseIds.has(item.caseId) ? "Slated" : "Waiting",
          ...clinicalFlagDefinitions.map((flag) => (item.flags?.[flag.key] ? "yes" : "no")),
        ]);
      });
    });
    downloadFile("office_long_waiters.csv", serializeCsv(rows));
  };

  const downloadLongWaitersPdf = () => {
    if (longWaiters.total === 0) return;
    let rank = 0;
    const rows: WaitlistPdfRow[] = [];
    longWaiters.groups.forEach((group) => {
      group.cases.forEach((item) => {
        rank += 1;
        rows.push({
          rank,
          primary: includeNamesInExports ? item.displayLabel : item.caseId,
          secondary: includeNamesInExports ? item.caseId : undefined,
          procedure: item.procedureName ?? "",
          benchmarkWeeks: item.benchmarkWeeks,
          timeToTargetDays: item.timeToTargetDays,
          overdueDays: Math.max(0, -item.timeToTargetDays),
          status: selectedCaseIds.has(item.caseId) ? "Slated" : "Waiting",
        });
      });
    });
    const surgeonName = surgeonNameFor(orderedByUrgency);
    downloadWaitlistPdf({
      heading: "LONG-WAITERS (OVER TARGET)",
      surgeonName,
      generatedLabel: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      summaryLabel: `${longWaiters.total} over target`,
      rows,
      fileName: `long_waiters_${fileSlug(surgeonName)}.pdf`,
    });
  };

  const toggleExpanded = (id: string) =>
    setExpandedCaseIds((prev) => ({ ...prev, [id]: !prev[id] }));

  const waitlistQ = waitlistQuery.trim().toLowerCase();
  const filteredWaitlist = orderedByUrgency
    .map((item, i) => ({ item, rank: i + 1 }))
    .filter(({ item }) => {
      if (waitlistOverdueOnly && item.timeToTargetDays >= 0) return false;
      if (waitlistUnslatedOnly && selectedCaseIds.has(item.caseId)) return false;
      if (!waitlistQ) return true;
      return (
        item.displayLabel.toLowerCase().includes(waitlistQ) ||
        item.caseId.toLowerCase().includes(waitlistQ) ||
        (item.procedureName ?? "").toLowerCase().includes(waitlistQ) ||
        item.surgeonId.toLowerCase().includes(waitlistQ)
      );
    });

  const tabs: { id: OfficeTab; label: string; badge?: number; danger?: boolean }[] = [
    { id: "setup", label: "Setup" },
    { id: "slates", label: "Suggested slates", badge: slates?.length ?? 0 },
    { id: "waitlist", label: "Priority waitlist", badge: orderedByUrgency.length },
    { id: "long", label: "Long-waiters", badge: longWaiters.total, danger: true },
  ];

  const activeDates = slateDates.slice(0, slateCount);
  const filledDates = activeDates.filter(Boolean);
  const todayISO = toLocalDateOnly(new Date());
  const planningWarnings: string[] = [];
  if (filledDates.length < activeDates.length) {
    planningWarnings.push("Set a date for every slate.");
  }
  if (new Set(filledDates).size < filledDates.length) {
    planningWarnings.push("Two slates use the same date.");
  }
  if (filledDates.some((d) => d < todayISO)) {
    planningWarnings.push("A slate date is in the past.");
  }
  if (officeSurgeons.length > 1) {
    planningWarnings.push(
      `Multiple surgeons detected (${officeSurgeons.join(
        ", "
      )}). This tool is intended for one surgeon's office — slates and the surgeon name on exports will mix surgeons.`
    );
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <div className="sticky top-0 z-30 -mx-6 mb-2 bg-sand-50/95 px-6 pt-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-sand-700">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sand-500">
            SlateBuilder for Offices
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              Cases <span className="font-semibold text-slateBlue-900">{officeStats.totalCases}</span>
            </span>
            <span className={officeStats.overdue > 0 ? "text-rose-600" : ""}>
              Overdue <span className="font-semibold">{officeStats.overdue}</span>
            </span>
            <span>
              Slated <span className="font-semibold text-slateBlue-900">{selectedCaseIds.size}</span>
            </span>
            <span>
              Waiting{" "}
              <span className="font-semibold text-slateBlue-900">{remainingByUrgency.length}</span>
            </span>
          </div>
        </div>
        <nav className="mt-2 flex gap-1 overflow-x-auto border-b border-sand-300" aria-label="Sections">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm transition-colors ${
                  active
                    ? "-mb-px border border-b-white border-sand-300 border-t-2 border-t-slateBlue-600 bg-white font-semibold text-slateBlue-900"
                    : "border border-transparent font-medium text-sand-500 hover:bg-white/60 hover:text-slateBlue-700"
                }`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      tab.danger
                        ? "bg-rose-100 text-rose-700"
                        : active
                          ? "bg-slateBlue-100 text-slateBlue-700"
                          : "bg-sand-100 text-sand-600"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "setup" && (
        <>
      <header>
        <div className="card p-8">
          <p className="text-sm uppercase tracking-[0.26em] text-sand-600">
            Office Scheduling Toolkit
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-slateBlue-900">
            SlateBuilder for Offices
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sand-800">
            Upload one surgeon office&apos;s waitlist, generate streamlined OR slates, and maintain
            a Priority Waitlist that clearly shows which patients are already slated and which are
            still waiting.
          </p>
          <p className="mt-3 max-w-3xl rounded-xl border border-sand-200 bg-white/70 px-4 py-3 text-xs leading-6 text-sand-700">
            <span className="font-semibold text-sand-900">How the priority score works:</span> each
            case scores its benchmark urgency weight (2w = 5, 4w = 4, 6w = 3, 12w = 2, 26w = 1)
            multiplied by how far it has waited toward target (the score climbs every day and keeps
            rising once past target). Patients already past target are slated first; the rest of the
            block is then filled to complete as many further cases as possible.
          </p>
          <p className="mt-3 max-w-3xl text-xs leading-6 text-sand-600">
            Patient names and PHNs never leave this device. Each case gets an opaque code (e.g.
            C-001); exports use that code unless you opt to include names. When you sign in, only
            pseudonymized, end-to-end-encrypted working data is synced to the cloud — never names,
            PHNs, or diagnoses.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-sand-700">
            <a
              href="/guide"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-slateBlue-700 px-4 py-1.5 font-semibold text-white"
            >
              User guide ↗
            </a>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Names &amp; PHNs stay on device
            </span>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Encrypted saves
            </span>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Up to 3 selectable OR dates
            </span>
          </div>
        </div>
      </header>

      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slateBlue-900">Office account &amp; sync</h2>
            <p className="text-sm text-sand-700">
              Sign in to share draft slates across devices. Only pseudonymized, encrypted working
              data is stored in the cloud — names and PHNs never leave this device.
            </p>
          </div>
          {signedInId && (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {signedInId}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-sand-300 px-3 py-1 text-xs font-semibold text-sand-800"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {!signedInId ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[180px] flex-1 flex-col gap-2 text-xs text-sand-700">
              Office name
              <input
                type="text"
                value={officeIdInput}
                onChange={(event) => setOfficeIdInput(event.target.value)}
                placeholder="e.g. bcwh-gyne-collins"
                className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="flex min-w-[180px] flex-1 flex-col gap-2 text-xs text-sand-700">
              Password
              <input
                type="password"
                value={officePassword}
                onChange={(event) => setOfficePassword(event.target.value)}
                placeholder="Shared office password"
                className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleLogin()}
              className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setShowReset((v) => !v)}
              className="text-xs font-semibold text-slateBlue-700 underline"
            >
              Forgot password?
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-sand-700">
            <span className="font-semibold text-sand-900">
              Draft status:
              <span
                className={`ml-2 rounded-full px-2 py-0.5 ${
                  planStatus === "finalized"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {planStatus}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPlanStatus(planStatus === "finalized" ? "draft" : "finalized")}
              className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
            >
              {planStatus === "finalized" ? "Reopen as draft" : "Mark finalized"}
            </button>
            <button
              type="button"
              onClick={() => setShowChangePw((v) => !v)}
              className="font-semibold text-slateBlue-700 underline"
            >
              Change password
            </button>
            {cases.length === 0 && (
              <span className="text-sand-500">Upload this month&apos;s waitlist to re-link saved work.</span>
            )}
          </div>
        )}

        {!signedInId && showReset && (
          <div className="mt-4 rounded-xl border border-sand-200 bg-white/70 p-4">
            <p className="text-xs font-semibold text-sand-900">Reset password with recovery code</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-2 text-xs text-sand-700">
                Recovery code
                <input
                  type="text"
                  value={recoveryCodeInput}
                  onChange={(event) => setRecoveryCodeInput(event.target.value)}
                  placeholder="From your administrator"
                  className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-2 text-xs text-sand-700">
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void handleReset()}
                className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Reset &amp; sign in
              </button>
            </div>
          </div>
        )}

        {signedInId && showChangePw && (
          <div className="mt-4 rounded-xl border border-sand-200 bg-white/70 p-4">
            <p className="text-xs font-semibold text-sand-900">Change password</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex min-w-[160px] flex-1 flex-col gap-2 text-xs text-sand-700">
                Current password
                <input
                  type="password"
                  value={officePassword}
                  onChange={(event) => setOfficePassword(event.target.value)}
                  className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-2 text-xs text-sand-700">
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void handleChangePassword()}
                className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Update password
              </button>
            </div>
          </div>
        )}

        {syncStatus && <p className="mt-3 text-xs text-sand-600">{syncStatus}</p>}
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">Load Office Waitlist</h2>
          <p className="mt-1 text-sm text-sand-700">
            Import the office&apos;s own CSV or Excel waitlist. All calculations stay in the browser.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-2xl border border-dashed border-sand-300 bg-white/70 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleUpload}
                  className="flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={resetWorkspace}
                  className="rounded-full border border-sand-300 bg-white px-4 py-2 text-xs font-semibold text-sand-800"
                >
                  Reset
                </button>
              </div>
              <label className="mt-3 flex items-start gap-2 text-xs text-sand-700">
                <input
                  type="checkbox"
                  checked={includeNamesInExports}
                  onChange={(event) => setIncludeNamesInExports(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-semibold text-sand-900">
                    Include patient names in exported CSVs
                  </span>
                  <span className="block text-sand-600">
                    Off (recommended): exports carry only the opaque case code. On: adds a
                    patient_label column. The screen always shows names either way.
                  </span>
                </span>
              </label>
            </div>
            <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-sand-900">Saved Work</p>
                <div className="flex items-center gap-3">
                  {lastAutosaveAt && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      All changes saved {lastAutosaveAt}
                    </span>
                  )}
                  {saveStatus && <span className="text-xs text-sand-600">{saveStatus}</span>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex min-w-[200px] flex-1 flex-col gap-2 text-xs text-sand-700">
                  Session name
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(event) => setSessionName(event.target.value)}
                    placeholder="March office slate draft"
                    className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex min-w-[200px] flex-1 flex-col gap-2 text-xs text-sand-700">
                  Passphrase
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    placeholder="Locks & unlocks saved work"
                    className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveSession()}
                  className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => void exportSession()}
                  className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
                >
                  Export session
                </button>
                <label className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700">
                  Import session
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportSession}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={clearAllSavedData}
                  className="rounded-full border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-700"
                >
                  Clear all data
                </button>
              </div>
              <p className="mt-3 text-xs text-sand-600">
                Named saves and exported files are encrypted with your passphrase (which is never
                stored) — keep it safe, as it cannot be recovered. Work is autosaved only for this
                browser tab and is cleared when the tab closes.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {savedSessions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-sand-300 bg-white px-3 py-4 text-xs text-sand-600">
                    No named saves yet.
                  </div>
                )}
                {savedSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-200 bg-white px-3 py-3 text-xs text-sand-700"
                  >
                    <div>
                      <p className="font-semibold text-sand-900">{session.name}</p>
                      <p>Saved {new Date(session.savedAt).toLocaleString()}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void loadSession(session)}
                        className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSession(session.id)}
                        className="rounded-full border border-sand-300 px-3 py-1 font-semibold text-sand-800"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-2xl border border-sand-200 bg-sand-50 px-4 py-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Parsing warnings</p>
                <ul className="mt-2 list-disc pl-4">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">Configure Scheduling Rules</h2>
          <div className="mt-4 grid gap-6">
            <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <p className="font-semibold text-sand-900">Priority rule</p>
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="priority"
                    value="urgency_then_ttt"
                    checked={priorityMode === "urgency_then_ttt"}
                    onChange={() => setPriorityMode("urgency_then_ttt")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">Urgency first, then wait time</span>
                    <span className="block text-xs text-sand-600">
                      Best for keeping the office Priority Waitlist aligned to benchmark class.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="priority"
                    value="ttt"
                    checked={priorityMode === "ttt"}
                    onChange={() => setPriorityMode("ttt")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">Wait time only</span>
                    <span className="block text-xs text-sand-600">
                      Strictly sort by days to target regardless of urgency bucket.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-sand-900">Default case durations (min)</p>
                <button
                  type="button"
                  onClick={saveDefaultDurations}
                  className="rounded-full border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-slateBlue-700"
                >
                  Save defaults
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 text-xs text-sand-700">
                  Hysteroscopy
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={defaultDurations.hysteroscopy}
                    onChange={(event) =>
                      setDefaultDurations((prev) => ({
                        ...prev,
                        hysteroscopy: Number(event.target.value),
                      }))
                    }
                    className="w-20 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-sand-700">
                  Laparoscopy
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={defaultDurations.laparoscopy}
                    onChange={(event) =>
                      setDefaultDurations((prev) => ({
                        ...prev,
                        laparoscopy: Number(event.target.value),
                      }))
                    }
                    className="w-20 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-sand-700">
                  Hysterectomy
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={defaultDurations.hysterectomy}
                    onChange={(event) =>
                      setDefaultDurations((prev) => ({
                        ...prev,
                        hysterectomy: Number(event.target.value),
                      }))
                    }
                    className="w-20 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-sand-700">
                  Other
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={defaultDurations.other}
                    onChange={(event) =>
                      setDefaultDurations((prev) => ({
                        ...prev,
                        other: Number(event.target.value),
                      }))
                    }
                    className="w-20 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                  />
                </label>
              </div>
              {defaultsSavedAt && <p className="mt-3 text-xs text-sand-600">Saved {defaultsSavedAt}</p>}
            </div>

            <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <p className="font-semibold text-sand-900">OR slate dates</p>
              <div className="mt-3 flex flex-col gap-4">
                <label className="flex flex-col gap-2">
                  Number of slates
                  <select
                    value={slateCount}
                    onChange={(event) => setSlateCount(Number(event.target.value))}
                    className="rounded-lg border border-sand-300 bg-white px-3 py-2"
                  >
                    <option value={1}>1 slate</option>
                    <option value={2}>2 slates</option>
                    <option value={3}>3 slates</option>
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: slateCount }).map((_, index) => (
                    <label key={`date-${index}`} className="flex flex-col gap-2 text-xs text-sand-700">
                      Slate {index + 1} date
                      <input
                        type="date"
                        value={slateDates[index] || ""}
                        onChange={(event) => updateSlateDate(index, event.target.value)}
                        className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-sand-600">
                  Standard day is 08:00-16:00. The 2nd and 4th Thursday run 09:00-16:00.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-slateBlue-900">Office Snapshot</h2>
        <p className="mt-1 text-sm text-sand-700">A quick read on the uploaded office waitlist.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <StatCard
            label="Cases"
            value={String(officeStats.totalCases)}
            detail="Total active patients loaded"
          />
          <StatCard
            label="Overdue"
            value={String(officeStats.overdue)}
            detail="Patients past target date"
          />
          <StatCard
            label="Urgent"
            value={String(officeStats.urgent)}
            detail="2w, 4w, or 6w benchmarks"
          />
          <StatCard
            label="Workload"
            value={`${officeStats.totalHours.toFixed(1)}h`}
            detail="Estimated operative time"
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sand-900">Waitlist overview</p>
              <p className="text-xs text-sand-600">By benchmark · under vs. over target</p>
            </div>
            {officeStats.totalCases > 0 ? (
              <>
                <div className="mt-2">
                  <WaitlistHistogram buckets={waitlistOverview} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sand-700">
                  {OVERVIEW_SEGMENTS.map((seg) => (
                    <span key={seg.key} className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: seg.color }}
                      />
                      {seg.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-sand-600">No waitlist uploaded yet.</p>
            )}
          </div>
          <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Detected surgeon IDs</p>
            <p className="mt-1 text-xs text-sand-700">
              {officeSurgeons.length > 0 ? officeSurgeons.join(", ") : "No waitlist uploaded yet."}
            </p>
          </div>
        </div>
      </section>
        </>
      )}

      {activeTab === "slates" && (
      <section className="flex flex-col gap-6">
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">Suggested Slates</h2>
              <p className="text-sm text-sand-700">
                Reorder cases manually after optimization and adjust durations as needed.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {slates && slates.length > 0 && (
                <button
                  type="button"
                  onClick={downloadAllSlatesPdfFile}
                  className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                >
                  Export all slates (PDF)
                </button>
              )}
              <button
                type="button"
                onClick={resetDurationOverrides}
                className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
              >
                Reset manual durations
              </button>
            </div>
          </div>

          {planningWarnings.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <p className="font-semibold text-amber-900">Check before you rely on these slates</p>
              <ul className="mt-2 list-disc pl-4">
                {planningWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-sand-200 bg-white/70 px-4 py-3 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Block length</p>
            <p className="mt-1">{blockMinutes} minutes</p>
            <p className="mt-2 text-xs text-sand-700">
              A 30-minute turnaround (OR prep) follows every case except the last of the day.
              Slates hold a maximum of 7 cases.
            </p>
          </div>

          {!slates && (
            <div className="mt-6 rounded-2xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
              Upload an office waitlist to generate slates.
            </div>
          )}

          {slates && slates.length === 0 && (
            <div className="mt-6 rounded-2xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
              No cases fit into the selected block lengths.
            </div>
          )}

          {slates && slates.length > 0 && (
            <div className="mt-6 flex flex-col gap-6">
              {slates.map((slate, slateIndex) => {
                const orderedSlate = orderedSlates[slateIndex] ?? slate.selected;
                const slateDate = slate.dateISO;
                const schedule = buildSchedule(orderedSlate, slateDate);
                const surgicalMinutes = orderedSlate.reduce(
                  (sum, item) => sum + item.estimatedDurationMin,
                  0
                );
                const turnaroundMinutes =
                  TURNAROUND_MINUTES * Math.max(0, orderedSlate.length - 1);
                const occupiedMinutes = surgicalMinutes + turnaroundMinutes;
                const utilizationPct =
                  slate.blockMinutes > 0 ? (occupiedMinutes / slate.blockMinutes) * 100 : 0;

                return (
                  <div
                    key={`slate-${slateIndex}`}
                    className="rounded-2xl border border-sand-200 bg-white/70 p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">
                          Slate {slateIndex + 1}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-slateBlue-900">
                          {orderedSlate.length} cases on {slateDate || "unspecified date"}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => downloadSlatePdfFile(slateIndex)}
                          className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                        >
                          Export slate PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadSlateCsv(slateIndex)}
                          className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
                        >
                          Export slate CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadMappingCsv(slateIndex)}
                          className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
                        >
                          Export case mapping
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <StatCard
                        label="Utilization"
                        value={`${utilizationPct.toFixed(1)}%`}
                        detail={`${occupiedMinutes} / ${slate.blockMinutes} min (incl. ${turnaroundMinutes} min TAT)`}
                      />
                      <StatCard
                        label="Start Time"
                        value={formatMinutesToTime(
                          getBlockStartMinutes(new Date(`${slateDate}T00:00:00`))
                        )}
                        detail="Calculated from block rule"
                      />
                    </div>

                    <div className="mt-4 rounded-2xl border border-sand-200 bg-white/70 p-4">
                      <CapacityBar totalMinutes={occupiedMinutes} blockMinutes={slate.blockMinutes} />
                      <p className="mt-2 text-xs text-sand-600">
                        {surgicalMinutes} min surgical + {turnaroundMinutes} min turnaround (30 min
                        after each case but the last).
                      </p>
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                      {schedule.map(({ item, start, end, tatAfter, tatEnd }, index) => (
                        <Fragment key={item.caseId}>
                        <div
                          draggable
                          onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                          onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sand-200 bg-white px-4 py-3 text-sm shadow-sm"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-sand-500">
                              #{index + 1} · {formatMinutesToTime(start)}-{formatMinutesToTime(end)}
                            </p>
                            <p className="font-semibold text-slateBlue-900">{item.displayLabel}</p>
                            <p className="text-[10px] uppercase tracking-wider text-sand-400">
                              {item.caseId}
                            </p>
                            <div className="mt-1">
                              <UrgencyBadge
                                benchmarkWeeks={item.benchmarkWeeks}
                                timeToTargetDays={item.timeToTargetDays}
                              />
                            </div>
                            <p className="mt-1 text-xs text-sand-700">
                              TTT {item.timeToTargetDays}d · {item.estimatedDurationMin}m
                            </p>
                            <p className="text-xs text-sand-600">Surgeon ID: {item.surgeonId}</p>
                            {item.unavailableUntil && (
                              <p className="text-xs text-sand-600">
                                Patient unavailable until {item.unavailableUntil}
                              </p>
                            )}
                            {item.procedureName && (
                              <p className="text-xs text-sand-600">{item.procedureName}</p>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-2 text-xs text-sand-700">
                            <div className="flex flex-wrap justify-end gap-2">
                              {clinicalFlagDefinitions
                                .filter((flag) => item.flags?.[flag.key])
                                .map((flag) => (
                                  <span
                                    key={`${item.caseId}-${flag.key}`}
                                    className="rounded-full bg-sand-100 px-2 py-1"
                                  >
                                    {flag.label}
                                  </span>
                                ))}
                              {item.inpatient && (
                                <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">
                                  Inpatient
                                </span>
                              )}
                              <span className="rounded-full bg-slateBlue-50 px-2 py-1 text-slateBlue-700">
                                Priority {item.priorityScore.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex flex-wrap justify-end gap-3">
                              {clinicalFlagDefinitions.map((flag) => (
                                <label key={`${item.caseId}-${flag.key}`} className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(item.flags?.[flag.key])}
                                    onChange={(event) =>
                                      updateFlag(item.caseId, flag.key, event.target.checked)
                                    }
                                  />
                                  {flag.label}
                                </label>
                              ))}
                            </div>
                            <label className="flex items-center gap-2">
                              Duration (min)
                              <input
                                type="number"
                                min={10}
                                step={5}
                                value={item.estimatedDurationMin}
                                onChange={(event) =>
                                  updateDuration(slateIndex, item.caseId, event.target.value)
                                }
                                className="w-20 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                              />
                            </label>
                            <label className="flex items-center gap-2">
                              Patient unavailable until
                              <input
                                type="date"
                                value={item.unavailableUntil ?? ""}
                                onChange={(event) =>
                                  updateUnavailableUntil(item.caseId, event.target.value)
                                }
                                className="rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => removeFromSuggestedSlates(item.caseId)}
                              className="rounded-full border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-sand-800"
                            >
                              Remove from suggested slates
                            </button>
                          </div>
                        </div>
                        {tatAfter && (
                          <div className="flex items-center gap-2 px-4 text-xs text-sand-500">
                            <span className="h-px flex-1 bg-sand-200" />
                            <span className="rounded-full bg-sand-100 px-2 py-0.5 font-medium">
                              ↻ 30-min turnaround · OR ready {formatMinutesToTime(tatEnd)}
                            </span>
                            <span className="h-px flex-1 bg-sand-200" />
                          </div>
                        )}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
      )}

      {activeTab === "waitlist" && (
      <section className="flex flex-col gap-6">
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">Priority Waitlist</h2>
              <p className="text-sm text-sand-700">
                Office-wide ranking with slated patients marked so staff can work directly from one
                list.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadWaitlistPdfFile}
                className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
              >
                Export priority PDF
              </button>
              <button
                type="button"
                onClick={downloadPriorityCsv}
                className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
              >
                Export priority CSV
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatCard
              label="Office List"
              value={String(orderedByUrgency.length)}
              detail="All patients in priority order"
            />
            <StatCard
              label="Still Waiting"
              value={String(remainingByUrgency.length)}
              detail="Not yet assigned to a generated slate"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={waitlistQuery}
              onChange={(event) => setWaitlistQuery(event.target.value)}
              placeholder="Search name, code or procedure…"
              className="min-w-[200px] flex-1 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-1.5 text-xs text-sand-700">
              <input
                type="checkbox"
                checked={waitlistOverdueOnly}
                onChange={(event) => setWaitlistOverdueOnly(event.target.checked)}
              />
              Overdue only
            </label>
            <label className="flex items-center gap-1.5 text-xs text-sand-700">
              <input
                type="checkbox"
                checked={waitlistUnslatedOnly}
                onChange={(event) => setWaitlistUnslatedOnly(event.target.checked)}
              />
              Not yet slated
            </label>
          </div>

          <p className="mt-2 text-xs text-sand-600">
            Showing {filteredWaitlist.length} of {orderedByUrgency.length}
          </p>

          <div className="mt-2 flex flex-col gap-1.5 text-sm">
            {filteredWaitlist.map(({ item, rank }) => {
              const expanded = Boolean(expandedCaseIds[item.caseId]);
              return (
                <div key={item.caseId} className="rounded-xl border border-sand-200 bg-white/70">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.caseId)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  >
                    <span className="w-6 shrink-0 text-xs font-semibold text-sand-500">{rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slateBlue-900">
                        {item.displayLabel}
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-sand-400">
                          {item.caseId}
                        </span>
                      </span>
                      {item.procedureName && (
                        <span className="block truncate text-xs text-sand-600">
                          {item.procedureName}
                        </span>
                      )}
                    </span>
                    <UrgencyBadge
                      benchmarkWeeks={item.benchmarkWeeks}
                      timeToTargetDays={item.timeToTargetDays}
                    />
                    <span className="hidden shrink-0 text-xs text-sand-600 sm:inline">
                      {item.estimatedDurationMin}m
                    </span>
                    {selectedCaseIds.has(item.caseId) ? (
                      <span className="shrink-0 rounded-full bg-slateBlue-100 px-2 py-0.5 text-[11px] text-slateBlue-700">
                        Slated
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-sand-600">
                        Waiting
                      </span>
                    )}
                    <span className="shrink-0 text-sand-400">{expanded ? "▾" : "▸"}</span>
                  </button>

                  {expanded && (
                    <div className="border-t border-sand-200 px-3 py-3 text-xs text-sand-700">
                      <div className="text-sand-600">
                        TTT {item.timeToTargetDays}d · Surgeon ID {item.surgeonId}
                        {item.unavailableUntil
                          ? ` · unavailable until ${item.unavailableUntil}`
                          : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {clinicalFlagDefinitions
                          .filter((flag) => item.flags?.[flag.key])
                          .map((flag) => (
                            <span
                              key={`${item.caseId}-${flag.key}`}
                              className="rounded-full bg-sand-100 px-2 py-1 text-sand-800"
                            >
                              {flag.label}
                            </span>
                          ))}
                        {item.inpatient && (
                          <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">
                            Inpatient
                          </span>
                        )}
                        {removedFromSlateSuggestions[item.caseId] && (
                          <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">
                            Removed from suggestions
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {clinicalFlagDefinitions.map((flag) => (
                          <label
                            key={`${item.caseId}-${flag.key}`}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(item.flags?.[flag.key])}
                              onChange={(event) =>
                                updateFlag(item.caseId, flag.key, event.target.checked)
                              }
                            />
                            {flag.label}
                          </label>
                        ))}
                        <label className="flex items-center gap-2">
                          Patient unavailable until
                          <input
                            type="date"
                            value={item.unavailableUntil ?? ""}
                            onChange={(event) =>
                              updateUnavailableUntil(item.caseId, event.target.value)
                            }
                            className="rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                          />
                        </label>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {removedFromSlateSuggestions[item.caseId] ? (
                          <button
                            type="button"
                            onClick={() => restoreToSuggestedSlates(item.caseId)}
                            className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                          >
                            Restore to suggested slates
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeFromSuggestedSlates(item.caseId)}
                            className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                          >
                            Remove from suggested slates
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredWaitlist.length === 0 && (
              <div className="rounded-2xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
                {orderedByUrgency.length === 0
                  ? "No office waitlist loaded yet."
                  : "No patients match the filter."}
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {activeTab === "long" && (
      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slateBlue-900">
              Long-waiters — over target
            </h2>
            <p className="text-sm text-sand-700">
              Every patient already past their target wait, grouped by urgency class (most overdue
              first). These are guaranteed onto slates before any not-yet-overdue case.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadLongWaitersPdf}
              className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
            >
              Export long-waiters PDF
            </button>
            <button
              type="button"
              onClick={downloadLongWaitersCsv}
              className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Export long-waiters CSV
            </button>
          </div>
        </div>

        {longWaiters.total === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
            No patients are over target.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-5 sm:grid-cols-2">
            {longWaiters.groups.map((group) => (
              <div
                key={group.label}
                className="rounded-2xl border border-sand-200 bg-white/70 p-4"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${urgencyChipClasses(
                      group.weeks
                    )}`}
                  >
                    {group.label}
                  </span>
                  <span className="text-sm font-semibold text-slateBlue-900">
                    {group.cases.length}
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {group.cases.length === 0 && (
                    <p className="text-xs text-sand-500">None over target.</p>
                  )}
                  {group.cases.slice(0, 8).map((item) => (
                    <div key={item.caseId} className="text-xs">
                      <p className="font-semibold text-slateBlue-900">{item.displayLabel}</p>
                      <p className="text-rose-600">
                        {Math.abs(item.timeToTargetDays)}d over target
                      </p>
                      {item.procedureName && (
                        <p className="text-sand-600">{item.procedureName}</p>
                      )}
                    </div>
                  ))}
                  {group.cases.length > 8 && (
                    <p className="text-xs text-sand-500">
                      +{group.cases.length - 8} more (see export)
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeTab === "setup" && (
      <section className="card p-6">
        <h2 className="text-lg font-semibold text-slateBlue-900">About</h2>
        <p className="mt-2 text-sm text-sand-800">
          SlateBuilder for Offices was designed by Dr Jonathan Collins for BC Women&apos;s Hospital
          Surgical Services use only. It was built using an AI tool, and the designer takes no
          responsibility for any errors or omissions in outputs.
        </p>
      </section>
      )}
    </main>
  );
}
