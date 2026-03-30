"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
} from "@slatebuilder/core";

type SpreadsheetRow = Record<string, string | number | boolean | null | undefined>;

type SavedOfficeSession = {
  version: 1;
  id: string;
  name: string;
  savedAt: string;
  state: {
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
};

const OFFICE_SAVED_SESSIONS_KEY = "slatebuilder-office-saved-sessions";
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

function csvEscape(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function serializeCsv(rows: string[][]) {
  return ["sep=,", ...rows.map((row) => row.map((value) => csvEscape(value)).join(","))].join(
    "\n"
  );
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
  const headers = [
    "source_key",
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
    const values = [
      sourceKey,
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

function reorderSlateByCaseIds(items: ScoredCase[], orderedIds: string[] | undefined) {
  if (!orderedIds || orderedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.caseId, item]));
  const ordered: ScoredCase[] = [];
  orderedIds.forEach((id) => {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      byId.delete(id);
    }
  });
  items.forEach((item) => {
    if (byId.has(item.caseId)) {
      ordered.push(item);
      byId.delete(item.caseId);
    }
  });
  return ordered;
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
    hysteroscopy: 60,
    laparoscopy: 90,
    hysterectomy: 180,
    other: 60,
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
  const [savedSessions, setSavedSessions] = useState<SavedOfficeSession[]>([]);
  const [sessionName, setSessionName] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

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
        setSavedSessions(JSON.parse(storedSessions) as SavedOfficeSession[]);
      } catch {
        // ignore malformed saved sessions
      }
    }
  }, []);

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
    const order = [2, 4, 6, 12, 26];
    return [...items].sort((a, b) => {
      if (priorityMode === "ttt") {
        return a.timeToTargetDays - b.timeToTargetDays;
      }
      const aGroup = order.indexOf(a.benchmarkWeeks);
      const bGroup = order.indexOf(b.benchmarkWeeks);
      if (aGroup !== bGroup) return aGroup - bGroup;
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

  const updateSlateDate = (index: number, value: string) => {
    setSlateDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const resetWorkspace = () => {
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
    window.localStorage.removeItem(OFFICE_AUTOSAVE_KEY);
    setSaveStatus("Workspace reset");
  };

  function buildSessionState() {
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

  function applySavedSession(session: SavedOfficeSession, persistMessage = true) {
    setCsvText(session.state.csvText);
    setDurationOverrides(session.state.durationOverrides ?? {});
    setUnavailableOverrides(session.state.unavailableOverrides ?? {});
    setFlagOverrides(session.state.flagOverrides ?? {});
    setRemovedFromSlateSuggestions(session.state.removedFromSlateSuggestions ?? {});
    setDefaultDurations(session.state.defaultDurations);
    setPriorityMode(session.state.priorityMode);
    setSlateCount(session.state.slateCount);
    setSlateDates(session.state.slateDates);
    setOrderedSlateCaseIds(session.state.orderedSlateCaseIds ?? []);
    setSessionName(session.name);
    if (persistMessage) {
      setSaveStatus(`Loaded "${session.name}"`);
    }
  }

  function persistSavedSessions(nextSessions: SavedOfficeSession[]) {
    setSavedSessions(nextSessions);
    window.localStorage.setItem(OFFICE_SAVED_SESSIONS_KEY, JSON.stringify(nextSessions));
  }

  const saveSession = (nameOverride?: string) => {
    const trimmedName = (nameOverride ?? sessionName).trim() || "Office Session";
    const existing = savedSessions.find((session) => session.name === trimmedName);
    const nextSession: SavedOfficeSession = {
      version: 1,
      id: existing?.id ?? `${Date.now()}`,
      name: trimmedName,
      savedAt: new Date().toISOString(),
      state: buildSessionState(),
    };
    const nextSessions = [nextSession, ...savedSessions.filter((session) => session.id !== nextSession.id)];
    persistSavedSessions(nextSessions);
    setSessionName(trimmedName);
    setSaveStatus(`Saved "${trimmedName}"`);
  };

  const deleteSession = (id: string) => {
    const nextSessions = savedSessions.filter((session) => session.id !== id);
    persistSavedSessions(nextSessions);
    setSaveStatus("Deleted saved session");
  };

  const exportSession = () => {
    const trimmedName = sessionName.trim() || "office-session";
    const payload: SavedOfficeSession = {
      version: 1,
      id: `${Date.now()}`,
      name: trimmedName,
      savedAt: new Date().toISOString(),
      state: buildSessionState(),
    };
    downloadJson(`${trimmedName.replace(/\s+/g, "-").toLowerCase()}.json`, payload);
    setSaveStatus(`Exported "${trimmedName}"`);
  };

  useEffect(() => {
    if (!csvText && cases.length === 0) return;
    const autosave: SavedOfficeSession = {
      version: 1,
      id: "autosave",
      name: sessionName.trim() || "Autosave",
      savedAt: new Date().toISOString(),
      state: buildSessionState(),
    };
    window.localStorage.setItem(OFFICE_AUTOSAVE_KEY, JSON.stringify(autosave));
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
    sessionName,
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
        const normalizedCsv = normalizeOfficeWorkbookToCsv(rows);
        setCsvText(normalizedCsv);
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
    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const parsed = JSON.parse(text) as SavedOfficeSession;
        applySavedSession(parsed);
      } catch {
        setSaveStatus("Could not import saved session");
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

  const buildSchedule = (items: ScoredCase[], slateIndex: number) => {
    const date = new Date(`${slateDates[slateIndex]}T00:00:00`);
    let cursor = getBlockStartMinutes(date);
    return items.map((item) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      cursor = end;
      return { item, start, end };
    });
  };

  const downloadSlateCsv = (slateIndex: number) => {
    if (!slates || !orderedSlates[slateIndex]) return;
    const orderedSlate = orderedSlates[slateIndex];
    const date = new Date(`${slateDates[slateIndex]}T00:00:00`);
    const startMinutes = getBlockStartMinutes(date);
    const rows = [
      [
        "order",
        "case_id",
        "start_time",
        "end_time",
        "patient_type",
        "procedure_name",
        "benchmark_weeks",
        "time_to_target_days",
        "estimated_duration_min",
        "unavailable_until",
        "surgeon_id",
        ...clinicalFlagDefinitions.map((flag) => flag.csvColumn),
        "risk_score",
      ],
    ];

    let cursor = startMinutes;
    orderedSlate.forEach((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      cursor = end;
      rows.push([
        String(index + 1),
        item.caseId,
        formatMinutesToTime(start),
        formatMinutesToTime(end),
        item.inpatient ? "Inpatient" : "Day Case",
        item.procedureName ?? "",
        String(item.benchmarkWeeks),
        String(item.timeToTargetDays),
        String(item.estimatedDurationMin),
        item.unavailableUntil ?? "",
        item.surgeonId,
        ...clinicalFlagDefinitions.map((flag) => (item.flags?.[flag.key] ? "yes" : "no")),
        item.riskScore.toFixed(2),
      ]);
    });

    const csv = serializeCsv(rows);
    downloadFile(`office_slate_${slateDates[slateIndex]}_${slateIndex + 1}.csv`, csv);
  };

  const downloadMappingCsv = (slateIndex: number) => {
    if (!orderedSlates[slateIndex] || orderedSlates[slateIndex].length === 0) return;
    const rows = [["case_id", "source_key"]];
    orderedSlates[slateIndex].forEach((item) => rows.push([item.caseId, item.sourceKey]));
    const csv = serializeCsv(rows);
    downloadFile(`office_case_mapping_${slateDates[slateIndex]}_${slateIndex + 1}.csv`, csv);
  };

  const downloadPriorityCsv = () => {
    if (orderedByUrgency.length === 0) return;
    const rows = [
      [
        "order",
        "case_id",
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

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <header className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
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
          <div className="mt-6 flex flex-wrap gap-3 text-xs text-sand-700">
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Local browser processing only
            </span>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Office-level upload
            </span>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Up to 3 selectable OR dates
            </span>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">Office Snapshot</h2>
          <p className="mt-1 text-sm text-sand-700">
            A quick read on the uploaded office waitlist.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
          <div className="mt-4 rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Detected surgeon IDs</p>
            <p className="mt-1 text-xs text-sand-700">
              {officeSurgeons.length > 0 ? officeSurgeons.join(", ") : "No waitlist uploaded yet."}
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">1. Load Office Waitlist</h2>
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
            </div>
            <div className="rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-sand-900">Saved Work</p>
                {saveStatus && <span className="text-xs text-sand-600">{saveStatus}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex min-w-[220px] flex-1 flex-col gap-2 text-xs text-sand-700">
                  Session name
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(event) => setSessionName(event.target.value)}
                    placeholder="March office slate draft"
                    className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => saveSession()}
                  className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={exportSession}
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
              </div>
              <p className="mt-3 text-xs text-sand-600">
                Work is autosaved in this browser, and named saves let you return later.
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
                        onClick={() => applySavedSession(session)}
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
          <h2 className="text-lg font-semibold text-slateBlue-900">2. Configure Scheduling Rules</h2>
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

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">3. Suggested Slates</h2>
              <p className="text-sm text-sand-700">
                Reorder cases manually after optimization and adjust durations as needed.
              </p>
            </div>
            <button
              type="button"
              onClick={resetDurationOverrides}
              className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Reset manual durations
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-sand-200 bg-white/70 px-4 py-3 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Block length</p>
            <p className="mt-1">{blockMinutes} minutes</p>
            <p className="mt-2 text-xs text-sand-700">Case times are assumed to include turnover.</p>
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
                const schedule = buildSchedule(orderedSlate, slateIndex);
                const totalMinutes = orderedSlate.reduce(
                  (sum, item) => sum + item.estimatedDurationMin,
                  0
                );
                const utilizationPct =
                  slate.blockMinutes > 0 ? (totalMinutes / slate.blockMinutes) * 100 : 0;

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
                          {orderedSlate.length} cases on {slateDates[slateIndex] || "unspecified date"}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => downloadSlateCsv(slateIndex)}
                          className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
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
                        detail={`${totalMinutes.toFixed(0)} / ${slate.blockMinutes} min`}
                      />
                      <StatCard
                        label="Start Time"
                        value={formatMinutesToTime(
                          getBlockStartMinutes(new Date(`${slateDates[slateIndex]}T00:00:00`))
                        )}
                        detail="Calculated from block rule"
                      />
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                      {schedule.map(({ item, start, end }, index) => (
                        <div
                          key={item.caseId}
                          draggable
                          onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                          onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sand-200 bg-white px-4 py-3 text-sm shadow-sm"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-sand-500">
                              #{index + 1} · {formatMinutesToTime(start)}-{formatMinutesToTime(end)}
                            </p>
                            <p className="font-semibold text-slateBlue-900">{item.caseId}</p>
                            <p className="text-xs text-sand-700">
                              Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d ·{" "}
                              {item.estimatedDurationMin}m
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
                                Risk {item.riskScore.toFixed(2)}
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
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">4. Priority Waitlist</h2>
              <p className="text-sm text-sand-700">
                Office-wide ranking with slated patients marked so staff can work directly from one
                list.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadPriorityCsv}
              className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Export priority CSV
            </button>
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

          <div className="mt-4 flex flex-col gap-2 text-sm">
            {orderedByUrgency.map((item, index) => (
              <div
                key={item.caseId}
                className="rounded-2xl border border-sand-200 bg-white/70 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-slateBlue-900">
                    #{index + 1} · {item.caseId}
                  </span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className="text-xs text-sand-700">{item.estimatedDurationMin}m</span>
                    {selectedCaseIds.has(item.caseId) && (
                      <span className="rounded-full bg-slateBlue-100 px-2 py-1 text-xs text-slateBlue-700">
                        Slated
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-xs text-sand-700">
                  Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d · Surgeon ID{" "}
                  {item.surgeonId}
                </div>
                {item.unavailableUntil && (
                  <div className="mt-1 text-xs text-sand-600">
                    Patient unavailable until {item.unavailableUntil}
                  </div>
                )}
                {item.procedureName && (
                  <div className="mt-1 text-xs text-sand-600">{item.procedureName}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {clinicalFlagDefinitions
                    .filter((flag) => item.flags?.[flag.key])
                    .map((flag) => (
                      <span
                        key={`${item.caseId}-${flag.key}`}
                        className="rounded-full bg-sand-100 px-2 py-1 text-xs text-sand-800"
                      >
                        {flag.label}
                      </span>
                    ))}
                  {item.inpatient && (
                    <span className="rounded-full bg-sand-200 px-2 py-1 text-xs text-sand-800">
                      Inpatient
                    </span>
                  )}
                  {removedFromSlateSuggestions[item.caseId] && (
                    <span className="rounded-full bg-sand-200 px-2 py-1 text-xs text-sand-800">
                      Removed from suggestions
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-sand-700">
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
                      className="rounded-full border border-slateBlue-200 px-3 py-1 text-xs font-semibold text-slateBlue-700"
                    >
                      Restore to suggested slates
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeFromSuggestedSlates(item.caseId)}
                      className="rounded-full border border-slateBlue-200 px-3 py-1 text-xs font-semibold text-slateBlue-700"
                    >
                      Remove from suggested slates
                    </button>
                  )}
                </div>
              </div>
            ))}

            {orderedByUrgency.length === 0 && (
              <div className="rounded-2xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
                No office waitlist loaded yet.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold text-slateBlue-900">About</h2>
        <p className="mt-2 text-sm text-sand-800">
          SlateBuilder Pro was designed by Dr Jonathan Collins for BC Women&apos;s Hospital Surgical
          Services use only. It was built using an AI tool, and the designer takes no responsibility
          for any errors or omissions in outputs.
        </p>
      </section>
    </main>
  );
}
