"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ClinicalFlagKey,
  formatMinutesToTime,
  getBlockMinutes,
  getBlockStartMinutes,
  getCsvTemplate,
  normalizeDateOnly,
  optimizeSlatesForDates,
  parseCsv,
  PatientCase,
  ScoredCase,
  clinicalFlagDefinitions,
} from "@slatebuilder/core";

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
    hysteroscopy: 60,
    laparoscopy: 90,
    hysterectomy: 180,
    other: 60,
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
  const [dragState, setDragState] = useState<{ slateIndex: number; caseId: string } | null>(
    null
  );

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
      return;
    }
    setOrderedSlates(slates.map((item) => sortForSlate(item.selected)));
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
    setOrderedSlates(slates.map((item) => sortForSlate(item.selected)));
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
    downloadFile(`surgical_slate_${slateDates[slateIndex]}_s${slateIndex + 1}.csv`, csv);
  };

  const downloadMappingCsv = (slateIndex: number) => {
    if (!orderedSlates[slateIndex] || orderedSlates[slateIndex].length === 0) return;
    const rows = [["case_id", "source_key"]];
    orderedSlates[slateIndex].forEach((item) => rows.push([item.caseId, item.sourceKey]));
    const csv = serializeCsv(rows);
    downloadFile(`case_mapping_${slateDates[slateIndex]}_s${slateIndex + 1}.csv`, csv);
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

  const downloadPriorityCsv = () => {
    if (orderedByUrgency.length === 0) return;
    const label =
      waitlistScope === "group" && selectedGroup ? selectedGroup : selectedSurgeon || "all";
    const rows = [
      [
        "order",
        "case_id",
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

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12">
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
        </div>
        <p className="max-w-2xl text-base text-sand-800">
          Upload a deidentified waitlist, prioritize by benchmark time and time-to-target, and
          maximize OR utilization. Drag to reorder cases after optimization for clinical
          considerations such as OSA, diabetes, out-of-town travel, high BMI, chronic pain, or
          special assist needs.
        </p>
        <p className="max-w-2xl text-xs text-sand-600">
          Privacy note: all processing happens locally in your browser. No data is uploaded or sent
          over the internet.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">1. Load Waitlist</h2>
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
                      Prioritize by clinical urgency then wait time
                    </span>
                    <span className="block text-xs text-sand-600">
                      Sort by benchmark (2w, 4w, 6w, 12w, 26w) and then TTT.
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
          <h2 className="text-lg font-semibold text-slateBlue-900">2. Select OR Days</h2>
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

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">3. Optimized Slates</h2>
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
              Case times include turnaround time.
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
                const schedule = buildSchedule(orderedSlate, slateIndex);
                const slateDate = slateDates[slateIndex];
                const slateStart = slateDate
                  ? getBlockStartMinutes(new Date(`${slateDate}T00:00:00`))
                  : blockStartMinutes;
                const totalMinutes = orderedSlate.reduce(
                  (sum, item) => sum + item.estimatedDurationMin,
                  0
                );
                const utilizationPct =
                  slate.blockMinutes > 0 ? (totalMinutes / slate.blockMinutes) * 100 : 0;
                const totalRiskScore = orderedSlate.reduce((sum, item) => sum + item.riskScore, 0);
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
                      </div>
                      <div
                        className="rounded-xl border border-sand-200 bg-white/70 p-3"
                        title="Sum of case risk scores in this slate. Higher means more urgent cases are included."
                      >
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Total Risk</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {totalRiskScore.toFixed(1)}
                        </p>
                        <p
                          className="text-xs text-sand-700"
                          title="Scaling factor that balances utilization minutes with clinical risk in the optimization."
                        >
                          Util weight {slate.utilizationWeight.toFixed(3)}
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
                      {schedule.map(({ item, start, end }, index) => (
                        <div
                          key={item.caseId}
                          draggable
                          onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                          onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sand-200 bg-white px-4 py-3 text-sm shadow-sm"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-sand-500">
                              #{index + 1} · {formatMinutesToTime(start)}–{formatMinutesToTime(end)}
                            </p>
                            <p className="font-semibold text-slateBlue-900">{item.caseId}</p>
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
                                Risk {item.riskScore.toFixed(2)}
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
              <h2 className="text-lg font-semibold text-slateBlue-900">Priority Waitlist</h2>
              <p className="text-sm text-sand-700">
                {priorityMode === "ttt"
                  ? "Sorted by time-to-target (TTT) regardless of urgency class."
                  : "Sorted by urgency class (2w→26w), then days to target."}
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

          <div className="mt-4 flex flex-col gap-2 text-sm">
            {orderedByUrgency.map((item, index) => (
              <div key={item.caseId} className="rounded-lg border border-sand-200 bg-white/70 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slateBlue-900">
                    #{index + 1} · {item.caseId}
                  </span>
                  <span className="text-xs text-sand-700">{item.estimatedDurationMin}m</span>
                </div>
                <div className="text-xs text-sand-700">
                  Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d
                </div>
                <div className="text-xs text-sand-600">Surgeon: {item.surgeonId}</div>
                {item.unavailableUntil && (
                  <div className="text-xs text-sand-600">
                    Patient unavailable until {item.unavailableUntil}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
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
                  {selectedCaseIds.has(item.caseId) && (
                    <span className="rounded-full bg-sand-200 px-2 py-1 text-xs text-sand-800">
                      Slated
                    </span>
                  )}
                  {removedFromSlateSuggestions[item.caseId] && (
                    <span className="rounded-full bg-sand-200 px-2 py-1 text-xs text-sand-800">
                      Removed from suggestions
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-sand-700">
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
                {item.procedureName && (
                  <div className="text-xs text-sand-600">{item.procedureName}</div>
                )}
              </div>
            ))}
            {orderedByUrgency.length === 0 && (
              <div className="rounded-lg border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
                No cases loaded for this surgeon.
              </div>
            )}
          </div>
        </div>
      </section>

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
              Wait-time metrics use time-to-target as a proxy (lower TTT = longer waiting).
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
                <p className="font-semibold text-sand-900">Longest waiting patients</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {topByLongestWait.map((item) => (
                    <li key={`max-${item.surgeon}`}>
                      {item.surgeon} · {item.maxWait.toFixed(1)} days
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-sand-200 bg-sand-50 p-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Lowest average wait time</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {topByLowestAvgWait.map((item) => (
                    <li key={`avg-${item.surgeon}`}>
                      {item.surgeon} · {item.avgWait.toFixed(1)} days
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
