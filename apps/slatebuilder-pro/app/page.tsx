"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  reorderSlateByCaseIds,
  priorityScoreOf,
  TURNAROUND_MINUTES,
} from "@slatebuilder/core";
import { downloadWaitlistPdf, WaitlistPdfRow } from "./slatePdf";

type ProTab = "setup" | "slates" | "waitlist" | "long";
const PRO_TAB_KEY = "slatebuilder-pro-tab";

// Urgency tint keyed by benchmark class (most urgent = red).
function urgencyChipClasses(weeks: number): string {
  if (weeks <= 2) return "bg-rose-100 text-rose-700";
  if (weeks <= 4) return "bg-orange-100 text-orange-700";
  if (weeks <= 6) return "bg-amber-100 text-amber-800";
  if (weeks <= 12) return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

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
  const [groups, setGroups] = useState<{ name: string; surgeons: string[] }[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupSurgeons, setNewGroupSurgeons] = useState<Record<string, boolean>>({});
  const [waitlistScope, setWaitlistScope] = useState<"surgeon" | "group">("surgeon");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [defaultDurations, setDefaultDurations] = useState({
    hysteroscopy: 30,
    laparoscopy: 60,
    hysterectomy: 180,
    other: 90,
  });
  const [defaultsSavedAt, setDefaultsSavedAt] = useState<string | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [priorityMode, setPriorityMode] = useState<"ttt" | "urgency_then_ttt">(
    "urgency_then_ttt"
  );
  const [slateCount, setSlateCount] = useState(1);
  const [slateDates, setSlateDates] = useState<string[]>(() => {
    const today = new Date();
    const dates = [0, 1, 2].map((offset) => {
      const next = new Date(today);
      next.setDate(today.getDate() + offset);
      return next.toISOString().slice(0, 10);
    });
    return dates;
  });
  const [selectedSurgeon, setSelectedSurgeon] = useState<string>("");
  const [orderedSlates, setOrderedSlates] = useState<ScoredCase[][]>([]);
  const [orderedSlateCaseIds, setOrderedSlateCaseIds] = useState<string[][]>([]);
  const [includeNamesInExports, setIncludeNamesInExports] = useState(false);
  const [dragState, setDragState] = useState<{ slateIndex: number; caseId: string } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<ProTab>("setup");
  const [expandedCaseIds, setExpandedCaseIds] = useState<Record<string, boolean>>({});
  const [waitlistQuery, setWaitlistQuery] = useState("");
  const [waitlistOverdueOnly, setWaitlistOverdueOnly] = useState(false);
  const [waitlistUnslatedOnly, setWaitlistUnslatedOnly] = useState(false);

  useEffect(() => {
    const t = window.sessionStorage.getItem(PRO_TAB_KEY);
    if (t === "setup" || t === "slates" || t === "waitlist" || t === "long") setActiveTab(t);
  }, []);
  useEffect(() => {
    window.sessionStorage.setItem(PRO_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!csvText) return;
    const result = parseCsv(csvText);
    setCases(result.cases);
    setWarnings(result.warnings);
    if (!selectedSurgeon && result.cases.length > 0) {
      setSelectedSurgeon(result.cases[0].surgeonId);
    }
  }, [csvText, selectedSurgeon]);

  useEffect(() => {
    const stored = window.localStorage.getItem("slatebuilder-default-durations");
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

  const casesWithDefaults = useMemo(() => {
    return cases.map((item) =>
      applyUnavailableOverrides(applyFlagOverrides(applyDefaultDuration(item)))
    );
  }, [cases, defaultDurations, flagOverrides, unavailableOverrides]);

  const surgeons = useMemo(() => {
    const unique = new Set(cases.map((item) => item.surgeonId));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [cases]);

  const surgeonStats = useMemo(() => {
    const map = new Map<
      string,
      { count: number; maxWait: number; avgWait: number }
    >();
    casesWithDefaults.forEach((item) => {
      const waitProxy = -item.timeToTargetDays;
      const current = map.get(item.surgeonId) ?? {
        count: 0,
        maxWait: waitProxy,
        avgWait: 0,
      };
      const nextCount = current.count + 1;
      const nextAvg = (current.avgWait * current.count + waitProxy) / nextCount;
      const nextMax = Math.max(current.maxWait, waitProxy);
      map.set(item.surgeonId, {
        count: nextCount,
        maxWait: nextMax,
        avgWait: nextAvg,
      });
    });
    return Array.from(map.entries()).map(([surgeon, stats]) => ({
      surgeon,
      ...stats,
    }));
  }, [casesWithDefaults]);

  const topByCount = useMemo(() => {
    return [...surgeonStats]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [surgeonStats]);

  const topByLongestWait = useMemo(() => {
    return [...surgeonStats]
      .sort((a, b) => b.maxWait - a.maxWait)
      .slice(0, 5);
  }, [surgeonStats]);

  const topByLowestAvgWait = useMemo(() => {
    return [...surgeonStats]
      .sort((a, b) => a.avgWait - b.avgWait)
      .slice(0, 5);
  }, [surgeonStats]);

  const filteredCases = useMemo(() => {
    if (!selectedSurgeon) return casesWithDefaults;
    return casesWithDefaults.filter((item) => item.surgeonId === selectedSurgeon);
  }, [casesWithDefaults, selectedSurgeon]);

  const filteredCasesWithOverrides = useMemo(() => {
    if (Object.keys(durationOverrides).length === 0) return filteredCases;
    return filteredCases.map((item) => {
      const override = durationOverrides[item.caseId];
      if (!override) return item;
      return { ...item, estimatedDurationMin: override };
    });
  }, [filteredCases, durationOverrides]);

  const slateEligibleCases = useMemo(() => {
    return filteredCasesWithOverrides.filter((item) => !removedFromSlateSuggestions[item.caseId]);
  }, [filteredCasesWithOverrides, removedFromSlateSuggestions]);

  const waitlistCases = useMemo(() => {
    if (waitlistScope === "group" && selectedGroup) {
      const group = groups.find((item) => item.name === selectedGroup);
      if (!group) return filteredCases;
      const set = new Set(group.surgeons);
      return casesWithDefaults.filter((item) => set.has(item.surgeonId));
    }
    return filteredCases;
  }, [waitlistScope, selectedGroup, groups, casesWithDefaults, filteredCases]);

  const waitlistCasesWithOverrides = useMemo(() => {
    if (Object.keys(durationOverrides).length === 0) return waitlistCases;
    return waitlistCases.map((item) => {
      const override = durationOverrides[item.caseId];
      if (!override) return item;
      return { ...item, estimatedDurationMin: override };
    });
  }, [waitlistCases, durationOverrides]);

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
    // orderedSlateCaseIds is intentionally omitted from deps: it is the output we
    // write here, and is read only to preserve prior manual ordering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slates, priorityMode]);

  const blockMinutes = useMemo(() => {
    if (!slateDates[0]) return 0;
    const date = new Date(`${slateDates[0]}T00:00:00`);
    return getBlockMinutes(date);
  }, [slateDates]);

  const blockStartMinutes = useMemo(() => {
    if (!slateDates[0]) return 0;
    const date = new Date(`${slateDates[0]}T00:00:00`);
    return getBlockStartMinutes(date);
  }, [slateDates]);

  const buildSchedule = (items: ScoredCase[], dateISO: string) => {
    const date = new Date(`${dateISO}T00:00:00`);
    let cursor = getBlockStartMinutes(date);
    return items.map((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      cursor = end;
      // Every case but the last is followed by a 30-min turnaround.
      const tatAfter = index < items.length - 1;
      const tatEnd = tatAfter ? end + TURNAROUND_MINUTES : end;
      if (tatAfter) cursor = tatEnd;
      return { item, start, end, tatAfter, tatEnd };
    });
  };

  const updateSlateDate = (index: number, value: string) => {
    setSlateDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
    };
    reader.readAsText(file);
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
      "slatebuilder-default-durations",
      JSON.stringify(defaultDurations)
    );
    setDefaultsSavedAt(new Date().toLocaleTimeString());
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
    downloadFile(`surgical_slate_${dateISO}_s${slateIndex + 1}.csv`, csv);
  };

  const downloadMappingCsv = (slateIndex: number) => {
    if (!orderedSlates[slateIndex] || orderedSlates[slateIndex].length === 0) return;
    // The reidentification key: opaque code -> patient label. This is the only
    // export that pairs codes with identifiers; keep it secured and do not
    // circulate it with the (deidentified) slate CSV.
    const dateISO = slates?.[slateIndex]?.dateISO ?? "undated";
    const rows = [["case_id", "patient_label"]];
    orderedSlates[slateIndex].forEach((item) => rows.push([item.caseId, item.displayLabel]));
    const csv = serializeCsv(rows);
    downloadFile(`CONFIDENTIAL_case_mapping_${dateISO}_s${slateIndex + 1}.csv`, csv);
  };

  const orderedByUrgency = useMemo(() => {
    return sortForWaitlist(waitlistCasesWithOverrides);
  }, [waitlistCasesWithOverrides, priorityMode]);

  const selectedCaseIds = useMemo(() => {
    const ids = new Set<string>();
    orderedSlates.forEach((slate) => {
      slate.forEach((item) => ids.add(item.caseId));
    });
    return ids;
  }, [orderedSlates]);

  // Long-waiters: every in-scope case past target, grouped by benchmark class,
  // most overdue first within each class.
  const longWaiters = useMemo(() => {
    const order = [2, 4, 6, 12, 26] as const;
    const groups = order.map((weeks) => ({
      weeks,
      label: `${weeks}w`,
      cases: [] as PatientCase[],
    }));
    const indexOf = new Map(order.map((weeks, i) => [weeks, i]));
    waitlistCasesWithOverrides
      .filter((c) => c.timeToTargetDays < 0)
      .forEach((c) => {
        const i = indexOf.get(c.benchmarkWeeks);
        if (i !== undefined) groups[i].cases.push(c);
      });
    groups.forEach((g) => g.cases.sort((a, b) => a.timeToTargetDays - b.timeToTargetDays));
    const total = groups.reduce((sum, g) => sum + g.cases.length, 0);
    return { groups, total };
  }, [waitlistCasesWithOverrides]);

  const waitlistLabel =
    waitlistScope === "group" && selectedGroup ? selectedGroup : selectedSurgeon || "Surgeon";
  const fileSlug = (value: string) =>
    value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "surgeon";

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
    downloadFile(`long_waiters_${fileSlug(waitlistLabel)}.csv`, serializeCsv(rows));
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
    downloadWaitlistPdf({
      heading: "LONG-WAITERS (OVER TARGET)",
      surgeonName: waitlistLabel,
      generatedLabel: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      summaryLabel: `${longWaiters.total} over target`,
      rows,
      fileName: `long_waiters_${fileSlug(waitlistLabel)}.pdf`,
    });
  };

  const downloadPriorityCsv = () => {
    if (orderedByUrgency.length === 0) return;
    const label =
      waitlistScope === "group" && selectedGroup ? selectedGroup : selectedSurgeon || "all";
    const rows = [
      [
        "order",
        "case_id",
        ...(includeNamesInExports ? ["patient_label"] : []),
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
    downloadFile(`priority_waitlist_${label}.csv`, csv);
  };

  const scrollToAbout = () => {
    const section = document.getElementById("about");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

  const overdueCount = orderedByUrgency.filter((item) => item.timeToTargetDays < 0).length;
  const slatedCount = orderedByUrgency.filter((item) => selectedCaseIds.has(item.caseId)).length;
  const tabs: { id: ProTab; label: string; badge?: number; danger?: boolean }[] = [
    { id: "setup", label: "Setup" },
    { id: "slates", label: "Optimized slates", badge: slates?.length ?? 0 },
    { id: "waitlist", label: "Priority waitlist", badge: orderedByUrgency.length },
    { id: "long", label: "Long-waiters", badge: longWaiters.total, danger: true },
  ];

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12">
      <div className="sticky top-0 z-30 -mx-6 mb-2 bg-sand-50/95 px-6 pt-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-sand-700">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sand-500">
            SlateBuilder Pro
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              Cases <span className="font-semibold text-slateBlue-900">{orderedByUrgency.length}</span>
            </span>
            <span className={overdueCount > 0 ? "text-rose-600" : ""}>
              Overdue <span className="font-semibold">{overdueCount}</span>
            </span>
            <span>
              Slated <span className="font-semibold text-slateBlue-900">{slatedCount}</span>
            </span>
            <span>
              Waiting{" "}
              <span className="font-semibold text-slateBlue-900">
                {orderedByUrgency.length - slatedCount}
              </span>
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
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-sand-600">Slate Builder</p>
            <h1 className="mt-2 text-4xl font-semibold text-slateBlue-900">
              SlateBuilder Pro
            </h1>
          </div>
          <div className="rounded-full border border-sand-300 bg-white/80 px-4 py-2 text-xs text-sand-700">
            Single-day, single-surgeon slate optimization (up to 3 selectable dates)
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-sand-600">
          <button
            type="button"
            onClick={scrollToAbout}
            className="rounded-full border border-sand-300 bg-white/70 px-3 py-1 font-semibold text-slateBlue-700"
          >
            About SlateBuilder Pro
          </button>
          <button
            type="button"
            onClick={() => setShowMetrics(true)}
            className="rounded-full border border-sand-300 bg-white/70 px-3 py-1 font-semibold text-slateBlue-700"
          >
            Advanced Metrics
          </button>
          <a
            href="/guide"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-slateBlue-700 px-3 py-1 font-semibold text-white"
          >
            User guide ↗
          </a>
        </div>
        <p className="max-w-2xl text-base text-sand-800">
          Upload a deidentified waitlist, prioritize by benchmark time and time-to-target, and
          maximize OR utilization. Drag to reorder cases after optimization for clinical
          considerations such as OSA, diabetes, out-of-town travel, high BMI, chronic pain, or
          special assist needs.
        </p>
        <p className="max-w-2xl rounded-xl border border-sand-200 bg-white/70 px-4 py-3 text-xs text-sand-700">
          <span className="font-semibold text-sand-900">How the priority score works:</span> each
          case scores its benchmark urgency weight (2w = 5, 4w = 4, 6w = 3, 12w = 2, 26w = 1)
          multiplied by how far it has waited toward its target (the score climbs every day and keeps
          rising once a patient is past target). Cases already past target are placed on the slate
          first; the rest of the block is then filled to do as many further cases as possible.
        </p>
        <p className="max-w-2xl text-xs text-sand-600">
          Privacy: all processing happens locally in your browser — no data is uploaded or sent over
          the internet. Each case is given an opaque code (e.g. C-001); exported slates use that code
          by default and only include patient names when you explicitly opt in below.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">Load Waitlist</h2>
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-xl border border-dashed border-sand-300 bg-white/70 p-4">
              <input
                type="file"
                accept=".csv"
                onChange={handleUpload}
                className="w-full text-sm"
              />
            </div>


            {warnings.length > 0 && (
              <div className="rounded-lg border border-sand-200 bg-sand-50 px-4 py-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Parsing warnings</p>
                <ul className="mt-2 list-disc pl-4">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeNamesInExports}
                  onChange={(event) => setIncludeNamesInExports(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-sand-900">
                    Include patient names in exported CSVs
                  </span>
                  <span className="block text-xs text-sand-600">
                    Off (recommended): exports show only the opaque case code, safe to share. On:
                    adds a patient_label column for an actionable named list. The on-screen slate
                    always shows names regardless.
                  </span>
                </span>
              </label>
            </div>

            <div className="rounded-xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
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
                    <span className="font-semibold">
                      Prioritize by composite priority (urgency + wait)
                    </span>
                    <span className="block text-xs text-sand-600">
                      Combines benchmark urgency with how far each patient has waited toward target.
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
                    <span className="font-semibold">Prioritize by absolute wait time only</span>
                    <span className="block text-xs text-sand-600">
                      Sort by time-to-target (TTT) regardless of urgency class.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <p className="font-semibold text-sand-900">Default case durations (min)</p>
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
              <div className="mt-3 flex items-center justify-between text-xs text-sand-600">
                <button
                  type="button"
                  onClick={saveDefaultDurations}
                  className="rounded-full border border-sand-300 bg-white px-3 py-1 font-semibold text-slateBlue-700"
                >
                  Save default durations
                </button>
                {defaultsSavedAt && <span>Saved {defaultsSavedAt}</span>}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-sand-600">
                <a
                  href="#groups"
                  className="rounded-full border border-sand-300 bg-white/70 px-3 py-1 font-semibold text-slateBlue-700"
                >
                  Surgeon Groups
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">Select OR Days</h2>
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-sand-800">
              Number of slates (up to 3)
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

            <div className="flex flex-col gap-3">
              {Array.from({ length: slateCount }).map((_, index) => (
                <label key={`date-${index}`} className="flex flex-col gap-2 text-sm text-sand-800">
                  OR date for slate {index + 1}
                  <input
                    type="date"
                    value={slateDates[index] || ""}
                    onChange={(event) => updateSlateDate(index, event.target.value)}
                    className="rounded-lg border border-sand-300 bg-white px-3 py-2"
                  />
                </label>
              ))}
            </div>

            <label className="flex flex-col gap-2 text-sm text-sand-800">
              Surgeon
              <select
                value={selectedSurgeon}
                onChange={(event) => setSelectedSurgeon(event.target.value)}
                className="rounded-lg border border-sand-300 bg-white px-3 py-2"
              >
                {surgeons.length === 0 && <option value="">No surgeons found</option>}
                {surgeons.map((surgeon) => (
                  <option key={surgeon} value={surgeon}>
                    {surgeon}
                  </option>
                ))}
              </select>
            </label>

            
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
              <h2 className="text-lg font-semibold text-slateBlue-900">Optimized Slates</h2>
              <p className="text-sm text-sand-700">Drag to reorder for clinical priorities.</p>
            </div>
            <button
              type="button"
              onClick={resetDurationOverrides}
              className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Reset default case duration
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-sand-200 bg-white/70 px-4 py-3 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Block length</p>
            <p className="mt-1">{blockMinutes} minutes</p>
            <p className="mt-2 text-xs text-sand-700">
              Standard day: 08:00–16:00 (480 min). 2nd &amp; 4th Thursday: 09:00–16:00 (420 min).
            </p>
            <p className="mt-1 text-xs text-sand-600">
              A 30-minute turnaround (OR prep) follows every case except the last of the day. Slates
              hold a maximum of 7 cases.
            </p>
          </div>

          {!slates && (
            <div className="mt-6 rounded-xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
              Upload a CSV to generate the slate.
            </div>
          )}

          {slates && slates.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
              No cases fit into the block length for the selected day.
            </div>
          )}

          {slates && slates.length > 0 && (
            <div className="mt-6 flex flex-col gap-6">
              {slates.map((slate, slateIndex) => {
                const orderedSlate = orderedSlates[slateIndex] ?? slate.selected;
                const slateDate = slate.dateISO;
                const schedule = buildSchedule(orderedSlate, slateDate);
                const slateStart = slateDate
                  ? getBlockStartMinutes(new Date(`${slateDate}T00:00:00`))
                  : blockStartMinutes;
                const surgicalMinutes = orderedSlate.reduce(
                  (sum, item) => sum + item.estimatedDurationMin,
                  0
                );
                const turnaroundMinutes =
                  TURNAROUND_MINUTES * Math.max(0, orderedSlate.length - 1);
                const totalMinutes = surgicalMinutes + turnaroundMinutes;
                const utilizationPct =
                  slate.blockMinutes > 0 ? (totalMinutes / slate.blockMinutes) * 100 : 0;
                const totalPriorityScore = orderedSlate.reduce((sum, item) => sum + item.priorityScore, 0);
                return (
                  <div key={`slate-${slateIndex}`} className="rounded-2xl border border-sand-200 bg-white/70 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">
                          Slate {slateIndex + 1}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-slateBlue-900">
                          {orderedSlate.length} cases · {utilizationPct.toFixed(1)}% utilization
                        </h3>
                        <p className="mt-1 text-xs text-sand-700">
                          Date {slateDate || "Not set"}
                        </p>
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

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-sand-200 bg-white/70 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Utilization</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {utilizationPct.toFixed(1)}%
                        </p>
                        <p className="text-xs text-sand-700">
                          {totalMinutes.toFixed(0)} / {slate.blockMinutes} min
                        </p>
                        <p className="text-[11px] text-sand-600">
                          {surgicalMinutes} min cases + {turnaroundMinutes} min TAT
                        </p>
                      </div>
                      <div
                        className="rounded-xl border border-sand-200 bg-white/70 p-3"
                        title="Sum of case priority scores in this slate. Higher means more urgent, more overdue cases are included."
                      >
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Total Priority</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {totalPriorityScore.toFixed(1)}
                        </p>
                        <p className="text-xs text-sand-700">
                          {orderedSlate.length} {orderedSlate.length === 1 ? "case" : "cases"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-sand-200 bg-white/70 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Start Time</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {formatMinutesToTime(slateStart)}
                        </p>
                        <p className="text-xs text-sand-700">Day start</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      {schedule.map(({ item, start, end, tatAfter, tatEnd }, index) => (
                        <Fragment key={item.caseId}>
                        <div
                          draggable
                          onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                          onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sand-200 bg-white px-4 py-3 text-sm shadow-sm"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-sand-500">
                              #{index + 1} · {formatMinutesToTime(start)}–{formatMinutesToTime(end)}
                            </p>
                            <p className="font-semibold text-slateBlue-900">{item.displayLabel}</p>
                            <p className="text-[10px] uppercase tracking-wider text-sand-400">
                              {item.caseId}
                            </p>
                            <p className="text-xs text-sand-700">
                              Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d · {item.estimatedDurationMin}m
                            </p>
                            <p className="text-xs text-sand-600">Surgeon: {item.surgeonId}</p>
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
                              <span className="rounded-full bg-slateBlue-50 px-2 py-1 text-slateBlue-700">
                                Priority {item.priorityScore.toFixed(2)}
                              </span>
                              {item.inpatient && (
                                <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">
                                  Inpatient
                                </span>
                              )}
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
                {priorityMode === "ttt"
                  ? "Sorted by time-to-target (TTT) regardless of urgency class."
                  : "Sorted by composite priority (urgency + time waited)."}
              </p>
              <p className="mt-1 text-xs text-sand-600">
                {waitlistScope === "group" && selectedGroup
                  ? `${orderedByUrgency.length} cases for ${selectedGroup}`
                  : selectedSurgeon
                    ? `${orderedByUrgency.length} cases for ${selectedSurgeon}`
                    : `${orderedByUrgency.length} cases`}
              </p>
            </div>
            <button
              type="button"
              onClick={downloadPriorityCsv}
              className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Export priority list
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-sand-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="waitlistScope"
                value="surgeon"
                checked={waitlistScope === "surgeon"}
                onChange={() => setWaitlistScope("surgeon")}
              />
              Selected surgeon only
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="waitlistScope"
                value="group"
                checked={waitlistScope === "group"}
                onChange={() => setWaitlistScope("group")}
              />
              Surgeon group
            </label>
            {waitlistScope === "group" && (
              <select
                value={selectedGroup}
                onChange={(event) => setSelectedGroup(event.target.value)}
                className="rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
              >
                {groups.length === 0 && <option value="">No groups</option>}
                {groups.map((group) => (
                  <option key={group.name} value={group.name}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}
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
                    <span className="shrink-0 rounded-full bg-sand-100 px-2 py-0.5 text-[11px] font-semibold text-sand-700">
                      {item.benchmarkWeeks}w
                    </span>
                    <span
                      className={`hidden shrink-0 text-xs sm:inline ${
                        item.timeToTargetDays < 0 ? "text-rose-600" : "text-sand-600"
                      }`}
                    >
                      TTT {item.timeToTargetDays}d
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
                        Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d ·{" "}
                        {item.estimatedDurationMin}m · Surgeon {item.surgeonId}
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
                  ? "No cases loaded for this surgeon."
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
            <h2 className="text-lg font-semibold text-slateBlue-900">Long-waiters — over target</h2>
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
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {longWaiters.groups.map((group) => (
              <div key={group.label} className="rounded-2xl border border-sand-200 bg-white/70 p-4">
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
                      {item.procedureName && <p className="text-sand-600">{item.procedureName}</p>}
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
        <>
      <section id="groups" className="card p-6 scroll-mt-24">
        <h2 className="text-lg font-semibold text-slateBlue-900">Surgeon Groups</h2>
        <p className="text-sm text-sand-700">
          Create custom surgeon groups for group-level priority waitlists.
        </p>
        <div className="mt-4">
          <div className="rounded-lg border border-sand-200 bg-white/70 px-4 py-3 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Surgeon groups</p>
            <div className="mt-3 grid gap-3">
              <label className="flex flex-col gap-2 text-xs text-sand-700">
                Group name
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  className="rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {surgeons.map((surgeon) => (
                  <label
                    key={`group-${surgeon}`}
                    className="flex items-center gap-2 text-xs text-sand-700"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(newGroupSurgeons[surgeon])}
                      onChange={(event) =>
                        setNewGroupSurgeons((prev) => ({
                          ...prev,
                          [surgeon]: event.target.checked,
                        }))
                      }
                    />
                    {surgeon}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const name = newGroupName.trim();
                  const selected = Object.entries(newGroupSurgeons)
                    .filter(([, value]) => value)
                    .map(([key]) => key);
                  if (!name || selected.length === 0) return;
                  setGroups((prev) => [...prev, { name, surgeons: selected }]);
                  setSelectedGroup(name);
                  setWaitlistScope("group");
                  setNewGroupName("");
                  setNewGroupSurgeons({});
                }}
                className="rounded-full border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-slateBlue-700"
              >
                Save group
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="card p-6 scroll-mt-24">
        <h2 className="text-lg font-semibold text-slateBlue-900">About</h2>
        <p className="mt-2 text-sm text-sand-800">
          SlateBuilder Pro was designed by Dr Jonathan Collins for BC Women&apos;s Hospital Surgical
          Services use only. It was built using an AI tool, and the designer takes no responsibility
          for any errors or omissions in outputs.
        </p>
      </section>
        </>
      )}

      {showMetrics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slateBlue-900">Advanced Metrics</h2>
              <button
                type="button"
                onClick={() => setShowMetrics(false)}
                className="rounded-full border border-sand-300 px-3 py-1 text-xs font-semibold text-slateBlue-700"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-xs text-sand-600">
              Shown as days past target (TTT): positive = overdue, negative = still within target.
              These are time-to-target figures, not measured wait durations.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-sand-200 bg-sand-50 p-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Most cases waiting</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {topByCount.map((item) => (
                    <li key={`count-${item.surgeon}`}>
                      {item.surgeon} · {item.count}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-sand-200 bg-sand-50 p-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Most overdue (days past target)</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {topByLongestWait.map((item) => (
                    <li key={`max-${item.surgeon}`}>
                      {item.surgeon} · {item.maxWait.toFixed(1)}d past target
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-sand-200 bg-sand-50 p-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Lowest average days past target</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {topByLowestAvgWait.map((item) => (
                    <li key={`avg-${item.surgeon}`}>
                      {item.surgeon} · {item.avgWait.toFixed(1)}d past target
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
