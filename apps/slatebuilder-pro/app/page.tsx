"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  applyDefaultDuration,
  applyFlagOverrides,
  applyUnavailableOverrides,
  BENCHMARK_WEEKS_ORDER,
  buildCaseSchedule,
  ClinicalFlagKey,
  DefaultDurations,
  formatMinutesToTime,
  getBlockMinutes,
  getBlockStartMinutes,
  describePlacement,
  PlacementMove,
  scoreCases,
  isAvailableOnDate,
  caseFitsInSlate,
  optimizeSlatesForDates,
  parseCsv,
  checkImportedWaitlist,
  ImportCheck,
  summarizeImport,
  PatientCase,
  PriorityMode,
  ScoredCase,
  clinicalFlagDefinitions,
  serializeCsv,
  reorderSlateByCaseIds,
  sortForSlate,
  sortForWaitlist,
  toLocalDateOnly,
  urgencyChipClasses,
  TURNAROUND_MINUTES,
  BOOKING_ORDER_TEXT,
  classifyBookingOrder,
  countBookingOrder,
  findUnexplainedPutOffs,
  unexplainedPutOffNote,
  OrderReason,
} from "@slatebuilder/core";
import { downloadWaitlistPdf, WaitlistPdfRow } from "@slatebuilder/core/slatePdf";
import {
  BookingOrderBadge,
  BookingOrderLegend,
  BookingOrderTally,
  OrderReasonEditor,
  OrderReasonPrompt,
} from "./bookingOrderUi";

// Aggregate sanity checks on a freshly uploaded waitlist.
//
// This sits above the tabs rather than inside Setup because the failure it
// guards against is precisely the one you do not notice: a units error or an
// unmatched column produces slates that look entirely normal, and someone who
// uploads and goes straight to Slates would never see a panel tucked under the
// upload box. It does not block the app -- a surgeon at 7am must never be
// locked out by a false positive -- but it takes a click to put away, so it
// cannot be dismissed by simply not reading it.
function ImportCheckPanel({
  checks,
  onAcknowledge,
}: {
  checks: ImportCheck[];
  onAcknowledge: () => void;
}) {
  const serious = checks.some((check) => check.severity === "serious");
  return (
    <section
      aria-labelledby="import-check-heading"
      className={`rounded-xl border-2 px-5 py-4 ${
        serious ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"
      }`}
    >
      <h2
        id="import-check-heading"
        className={`text-sm font-semibold ${serious ? "text-rose-900" : "text-amber-900"}`}
      >
        {serious
          ? "This file may not have loaded correctly"
          : "Worth a look before you use these slates"}
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {checks.map((check) => (
          <li key={check.id} className="text-sm">
            <p
              className={`font-semibold ${
                check.severity === "serious" ? "text-rose-900" : "text-amber-900"
              }`}
            >
              {check.headline}
            </p>
            <p className="mt-0.5 text-sand-800">{check.detail}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onAcknowledge}
          className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-white ${
            serious ? "bg-rose-700 hover:bg-rose-800" : "bg-amber-700 hover:bg-amber-800"
          }`}
        >
          I have checked these
        </button>
        <span className="text-xs text-sand-700">
          Nothing is blocked. This appears again the next time you load a waitlist.
        </span>
      </div>
    </section>
  );
}


type ProTab = "setup" | "slates" | "waitlist" | "long";
const PRO_TAB_KEY = "slatebuilder-pro-tab";

// Three stacked bars: the day's slates.
function SlateMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      <rect width="22" height="22" rx="6" className="fill-slateBlue-700" />
      <rect x="5" y="5.5" width="12" height="2.5" rx="1.25" fill="white" />
      <rect x="5" y="9.75" width="9" height="2.5" rx="1.25" fill="white" opacity="0.85" />
      <rect x="5" y="14" width="10.5" height="2.5" rx="1.25" fill="white" opacity="0.7" />
    </svg>
  );
}

// Each slate's own colour, so its column and every case card on it read as
// one day at a glance.
const SLATE_ACCENTS = [
  { frame: "border-sand-200 border-t-slateBlue-500", header: "bg-slateBlue-50/70", label: "text-slateBlue-700", card: "border-l-slateBlue-400" },
  { frame: "border-sand-200 border-t-teal-500", header: "bg-teal-50/70", label: "text-teal-700", card: "border-l-teal-400" },
  { frame: "border-sand-200 border-t-fuchsia-500", header: "bg-fuchsia-50/70", label: "text-fuchsia-700", card: "border-l-fuchsia-400" },
];

function CapacityBar({ totalMinutes, blockMinutes }: { totalMinutes: number; blockMinutes: number }) {
  const pct = blockMinutes > 0 ? (totalMinutes / blockMinutes) * 100 : 0;
  const over = totalMinutes > blockMinutes;
  const remaining = blockMinutes - totalMinutes;
  // In an OR a full block is the goal: green when well used, amber when
  // noticeably underused, red only when the cases run past the block.
  const barColor = over ? "bg-rose-500" : pct >= 85 ? "bg-emerald-500" : "bg-amber-500";
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
  const [importChecks, setImportChecks] = useState<ImportCheck[]>([]);
  const [importChecksRead, setImportChecksRead] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  // Bumped with every upload so that re-loading a byte-identical file still
  // re-parses: without it React sees no change to csvText and the upload
  // silently does nothing.
  const [uploadNonce, setUploadNonce] = useState(0);
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
  const [defaultDurations, setDefaultDurations] = useState<DefaultDurations>({
    hysteroscopy: 30,
    laparoscopy: 60,
    hysterectomy: 180,
    other: 90,
  });
  const [defaultsSavedAt, setDefaultsSavedAt] = useState<string | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [priorityMode, setPriorityMode] = useState<PriorityMode>("urgency_then_ttt");
  const [slateCount, setSlateCount] = useState(1);
  const [slateDates, setSlateDates] = useState<string[]>(() => {
    const today = new Date();
    // toLocalDateOnly (not toISOString, which is UTC) so the default OR dates
    // land on the browser's actual calendar day regardless of time zone.
    // 3, 5 and 7 weeks from today, the same defaults as SlateBuilder for Offices.
    const dates = [21, 35, 49].map((offset) => {
      const next = new Date(today);
      next.setDate(today.getDate() + offset);
      return toLocalDateOnly(next);
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
  // UI-only drag feedback: which case is currently lifted, purely visual.
  const [draggingCaseId, setDraggingCaseId] = useState<string | null>(null);
  // Case IDs the user has manually reordered via drag, so their card can show
  // a "moved from suggestion" hint.
  const [movedCaseIds, setMovedCaseIds] = useState<Record<string, true>>({});
  // Why a patient was held back from the suggested slates, where someone has
  // said. This app keeps nothing between sessions, so neither is this.
  const [orderReasons, setOrderReasons] = useState<Record<string, OrderReason>>({});
  // Asking for the reason at the moment a patient is held back: the handler
  // names the patient, and an effect opens the prompt once the slates have
  // been rebuilt without them, if the hold-back turns out to need a reason.
  // A patient just moved by hand, and where they should now be (a slate date,
  // or null when held back). An effect waits for the slates to settle there,
  // then opens the prompt if the move needs a reason.
  const [reasonCheck, setReasonCheck] = useState<{ caseId: string; dateISO: string | null } | null>(
    null
  );
  const [reasonPrompt, setReasonPrompt] = useState<{ caseId: string; what: string } | null>(null);
  // Patients a person dragged onto another day's slate: case id → that date.
  // The optimizer puts each on its date first and plans everyone else around
  // them, so a placement holds when the slates are re-planned after an edit.
  const [manualPlacements, setManualPlacements] = useState<Record<string, string>>({});
  // Which slate a dragged case is hovering over, for the drop highlight.
  const [dragOverSlate, setDragOverSlate] = useState<number | null>(null);
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
    setImportChecks(checkImportedWaitlist(result));
    setImportChecksRead(false);
    setImportSummary(result.cases.length > 0 ? summarizeImport(result.cases).line : null);
    if (!selectedSurgeon && result.cases.length > 0) {
      setSelectedSurgeon(result.cases[0].surgeonId);
    }
  }, [csvText, selectedSurgeon, uploadNonce]);

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


  const casesWithDefaults = useMemo(() => {
    return cases.map((item) =>
      applyUnavailableOverrides(
        applyFlagOverrides(applyDefaultDuration(item, defaultDurations), flagOverrides),
        unavailableOverrides
      )
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

  const sortWaitlistByPriority = (items: PatientCase[]) => sortForWaitlist(items, priorityMode);

  const sortSlateByPriority = (items: ScoredCase[]) => sortForSlate(items, priorityMode);

  const slates = useMemo(() => {
    if (slateEligibleCases.length === 0) return null;
    const dates = slateDates
      .slice(0, slateCount)
      .filter(Boolean)
      .map((date) => new Date(`${date}T00:00:00`));
    if (dates.length === 0) return null;
    return optimizeSlatesForDates(slateEligibleCases, dates, manualPlacements);
  }, [slateEligibleCases, slateDates, slateCount, manualPlacements]);

  // Placements that still apply: on a date being planned, and a day the
  // patient can come. The rest are ignored by the optimizer too.
  const activePlacements = useMemo(() => {
    const active: Record<string, string> = {};
    const dates = new Set(slateDates.slice(0, slateCount).filter(Boolean));
    slateEligibleCases.forEach((item) => {
      const iso = manualPlacements[item.caseId];
      if (iso && dates.has(iso) && isAvailableOnDate(item.unavailableUntil, new Date(`${iso}T00:00:00`))) {
        active[item.caseId] = iso;
      }
    });
    return active;
  }, [manualPlacements, slateDates, slateCount, slateEligibleCases]);

  useEffect(() => {
    if (!slates) {
      setOrderedSlates([]);
      setOrderedSlateCaseIds([]);
      return;
    }
    const nextOrdered = slates.map((item, index) =>
      reorderSlateByCaseIds(sortSlateByPriority(item.selected), orderedSlateCaseIds[index])
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

  const updateSlateDate = (index: number, value: string) => {
    setSlateDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Clears every piece of state keyed by caseId. caseIds are reassigned by
  // row order on every parseCsv() call (see csv.ts), not derived from case
  // content, so without this a re-upload can silently reattach a stale
  // override (e.g. a manual duration edit or "removed from suggested slates")
  // to a different, unrelated patient that happens to land on the same row.
  const clearCaseKeyedState = () => {
    setDurationOverrides({});
    setUnavailableOverrides({});
    setFlagOverrides({});
    setRemovedFromSlateSuggestions({});
    setOrderReasons({});
    setReasonCheck(null);
    setReasonPrompt(null);
    setManualPlacements({});
    setMovedCaseIds({});
    setOrderedSlates([]);
    setOrderedSlateCaseIds([]);
    setDragState(null);
    setDraggingCaseId(null);
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    clearCaseKeyedState();
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
      setUploadNonce((n) => n + 1);
    };
    reader.readAsText(file);
  };

  const handleDragStart = (slateIndex: number, caseId: string) => {
    setDragState({ slateIndex, caseId });
    setDraggingCaseId(caseId);
  };

  // Fires once the drag gesture ends, whether or not it landed on a valid
  // drop target — clears all transient drag-feedback state so nothing sticks.
  const handleDragEnd = () => {
    setDragOverSlate(null);
    setDragState(null);
    setDraggingCaseId(null);
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
      setMovedCaseIds((prevMoved) =>
        prevMoved[dragState.caseId] ? prevMoved : { ...prevMoved, [dragState.caseId]: true }
      );
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
    setManualPlacements((prev) => {
      if (!prev[caseId]) return prev;
      const next = { ...prev };
      delete next[caseId];
      return next;
    });
    setReasonCheck({ caseId, dateISO: null });
  };

  // Dropping a case onto another day's slate. The patient is placed on that
  // date by hand and the optimizer re-plans everyone else around the
  // placements, so anyone displaced goes to the best date left for them or
  // back to the waitlist. The moves are shown for confirmation first.
  const handleDropOnSlate = (event: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault();
    const current = dragState;
    setDragState(null);
    setDraggingCaseId(null);
    setDragOverSlate(null);
    if (!current || !slates || current.slateIndex === targetIndex) return;
    const target = slates[targetIndex];
    const item = slateEligibleCases.find((c) => c.caseId === current.caseId);
    if (!target || !item) return;
    const date = new Date(`${target.dateISO}T00:00:00`);
    if (!isAvailableOnDate(item.unavailableUntil, date)) {
      window.alert("This patient is marked unavailable on that slate's date.");
      return;
    }
    // Hand-placed cases on the target day must still fit with this one.
    const placedThere = slateEligibleCases.filter(
      (c) => c.caseId !== item.caseId && activePlacements[c.caseId] === target.dateISO
    );
    let surgical = 0;
    for (const c of placedThere) surgical += c.estimatedDurationMin;
    if (!caseFitsInSlate(surgical, placedThere.length, item.estimatedDurationMin, target.blockMinutes)) {
      window.alert(
        caseFitsInSlate(0, 0, item.estimatedDurationMin, target.blockMinutes)
          ? "That slate is full, and the only cases that could make room were placed there by hand. Move one of them first."
          : "This patient's case is too long for that day's block."
      );
      return;
    }

    const nextPlacements = { ...activePlacements, [item.caseId]: target.dateISO };
    const dates = slates.map((s) => new Date(`${s.dateISO}T00:00:00`));
    const preview = optimizeSlatesForDates(slateEligibleCases, dates, nextPlacements);
    const before = new Map<string, string>();
    slates.forEach((s, i) =>
      (orderedSlates[i] ?? s.selected).forEach((c) => before.set(c.caseId, s.dateISO))
    );
    const after = new Map<string, string>();
    preview.forEach((s) => s.selected.forEach((c) => after.set(c.caseId, s.dateISO)));
    const moves: PlacementMove[] = [];
    before.forEach((fromISO, caseId) => {
      const toISO = after.get(caseId) ?? null;
      if (toISO !== fromISO) moves.push({ caseId, fromDateISO: fromISO, toDateISO: toISO });
    });
    after.forEach((toISO, caseId) => {
      if (!before.has(caseId)) moves.push({ caseId, fromDateISO: null, toDateISO: toISO });
    });
    // Who else moves, with anyone ranked above this patient who is pushed
    // later named first. See describePlacement.
    const warning = describePlacement({
      placed: scoreCases([item])[0],
      toDateISO: target.dateISO,
      moves,
      cases: scoreCases(slateEligibleCases),
      priorityMode,
    });
    if (warning && !window.confirm(warning.message)) return;
    setManualPlacements(nextPlacements);
    setMovedCaseIds((prev) => (prev[item.caseId] ? prev : { ...prev, [item.caseId]: true }));
    setReasonCheck({ caseId: item.caseId, dateISO: target.dateISO });
  };

  const restoreToSuggestedSlates = (caseId: string) => {
    setRemovedFromSlateSuggestions((prev) => {
      const next = { ...prev };
      delete next[caseId];
      return next;
    });
  };

  // Records, changes or clears the reason a patient was held back.
  const updateOrderReason = (caseId: string, reason: OrderReason | undefined) => {
    setOrderReasons((prev) => {
      const next = { ...prev };
      if (reason) next[caseId] = reason;
      else delete next[caseId];
      return next;
    });
  };

  // Whether each slated case was booked in priority order and, if not, why.
  // A case dragged onto another day's slate is a hand placement, marked
  // Clinical or No reason like in SlateBuilder for Offices. Holding a patient back never changes the marks on the cases
  // behind them; an unexplained hold-back is listed and noted on the slate.
  const bookingOrderInput = useMemo(
    () => ({
      slates: (slates ?? []).map((slate, i) => ({
        dateISO: slate.dateISO,
        cases: orderedSlates[i] ?? slate.selected,
      })),
      candidates: filteredCasesWithOverrides,
      priorityMode,
      manualPlacements: activePlacements,
      heldBack: removedFromSlateSuggestions,
      reasons: orderReasons,
    }),
    [
      slates,
      orderedSlates,
      filteredCasesWithOverrides,
      priorityMode,
      activePlacements,
      removedFromSlateSuggestions,
      orderReasons,
    ]
  );
  const bookingOrder = useMemo(() => classifyBookingOrder(bookingOrderInput), [bookingOrderInput]);

  const unexplainedPutOffs = useMemo(
    () => findUnexplainedPutOffs(bookingOrderInput),
    [bookingOrderInput]
  );
  const putOffCountByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    unexplainedPutOffs.forEach((entry) =>
      entry.slateDates.forEach((dateISO) => {
        counts[dateISO] = (counts[dateISO] ?? 0) + 1;
      })
    );
    return counts;
  }, [unexplainedPutOffs]);

  // Everyone a person moved with nothing to account for it, each listed once
  // with what was done: dragged onto a slate ahead of others, moved to a
  // later slate, or held back.
  const patientsNeedingReason = useMemo(() => {
    const what = new Map<string, string>();
    Object.values(bookingOrder).forEach((entry) =>
      entry.needsReasonCaseIds.forEach((caseId) =>
        what.set(caseId, `moved onto the ${activePlacements[caseId] ?? ""} slate ahead of others`)
      )
    );
    unexplainedPutOffs.forEach((entry) =>
      what.set(
        entry.caseId,
        entry.kind === "held_back"
          ? "held back from the suggested slates"
          : `moved to the later ${activePlacements[entry.caseId] ?? ""} slate`
      )
    );
    return filteredCasesWithOverrides
      .filter((item) => what.has(item.caseId))
      .map((item) => ({ item, what: what.get(item.caseId) ?? "" }));
  }, [bookingOrder, unexplainedPutOffs, activePlacements, filteredCasesWithOverrides]);

  // Open the prompt for a patient who was just moved, if the move needs a
  // reason. The slate cards are rebuilt one render after the optimizer's own
  // result changes, so wait until the patient is where the move put them:
  // judging any earlier would still see the old slates.
  const slatedDateOf = useMemo(() => {
    const at: Record<string, string> = {};
    (slates ?? []).forEach((slate, i) =>
      (orderedSlates[i] ?? []).forEach((item) => (at[item.caseId] = slate.dateISO))
    );
    return at;
  }, [slates, orderedSlates]);
  useEffect(() => {
    if (!reasonCheck) return;
    if ((slatedDateOf[reasonCheck.caseId] ?? null) !== reasonCheck.dateISO) return;
    const entry = patientsNeedingReason.find((e) => e.item.caseId === reasonCheck.caseId);
    if (entry) setReasonPrompt({ caseId: reasonCheck.caseId, what: entry.what });
    setReasonCheck(null);
  }, [reasonCheck, slatedDateOf, patientsNeedingReason]);

  const resetDurationOverrides = () => {
    setDurationOverrides({});
    if (!slates) return;
    const nextOrdered = slates.map((item) => sortSlateByPriority(item.selected));
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
        "booking_order",
        "booking_order_reason",
        "slate_held_back_no_reason",
      ],
    ];

    let cursor = startMinutes;
    orderedSlate.forEach((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      const tatAfter = index < orderedSlate.length - 1;
      cursor = end + (tatAfter ? TURNAROUND_MINUTES : 0);
      const order = bookingOrder[item.caseId];
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
        order ? BOOKING_ORDER_TEXT[order.status].label : "",
        order ? order.reasons.join("; ") : "",
        // About the slate, not the row: how many higher-ranked patients were
        // held back from it with no reason recorded. Repeated on every row so
        // the figure survives sorting and filtering in a spreadsheet.
        String(putOffCountByDate[dateISO] ?? 0),
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
    return sortWaitlistByPriority(waitlistCasesWithOverrides);
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
    const groups = BENCHMARK_WEEKS_ORDER.map((weeks) => ({
      weeks,
      label: `${weeks}w`,
      cases: [] as PatientCase[],
    }));
    const indexOf = new Map(BENCHMARK_WEEKS_ORDER.map((weeks, i) => [weeks, i]));
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
    <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 pb-12">
      {/* The top bar runs the full width of the window; its contents line up
          with the page column below. */}
      <div className="sticky top-0 z-30 mx-[calc(50%-50vw)] border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3 text-xs text-sand-700">
          <a href="/" className="flex items-center gap-2" aria-label="SlateBuilder Pro">
            <SlateMark />
            <span className="text-base font-semibold tracking-tight text-slateBlue-900">SlateBuilder</span>
            <span className="text-sm text-sand-500">Pro</span>
          </a>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
            <button
              type="button"
              onClick={() => setShowMetrics(true)}
              className="rounded-lg border border-sand-300 px-3 py-1 text-[11px] font-semibold text-slateBlue-700 hover:bg-sand-50"
            >
              Advanced metrics
            </button>
            <a
              href="/guide"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-slateBlue-700 hover:underline"
            >
              User guide ↗
            </a>
          </div>
        </div>
        <nav className="mt-2 flex gap-1 overflow-x-auto" aria-label="Sections">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "border-slateBlue-600 font-semibold text-slateBlue-900"
                    : "border-transparent font-medium text-sand-500 hover:border-sand-300 hover:text-slateBlue-700"
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
      </div>

      {importChecks.length > 0 && !importChecksRead && (
        <ImportCheckPanel checks={importChecks} onAcknowledge={() => setImportChecksRead(true)} />
      )}

      {activeTab === "setup" && (
        <>

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


            {importSummary && (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                <span className="font-semibold">Read as:</span> {importSummary}.{" "}
                If that does not match the list you know, stop and check the file rather than the
                slates.
              </p>
            )}

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
                  className="rounded-lg border border-sand-300 bg-white px-3 py-1 font-semibold text-slateBlue-700"
                >
                  Save default durations
                </button>
                {defaultsSavedAt && <span>Saved {defaultsSavedAt}</span>}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-sand-600">
                <a
                  href="#groups"
                  className="rounded-lg border border-sand-300 bg-white/70 px-3 py-1 font-semibold text-slateBlue-700"
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
              <p className="text-sm text-sand-700">
                Drag to reorder within a day, or onto another day&apos;s slate to move a patient there.
              </p>
            </div>
            <button
              type="button"
              onClick={resetDurationOverrides}
              className="rounded-lg border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
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

          {slates && slates.length > 0 && (
            <div className="mt-4 rounded-lg border border-sand-200 bg-white/70 px-4 py-3 text-sm text-sand-800">
              <p className="font-semibold text-sand-900">Booking order</p>
              <p className="mt-1 text-xs text-sand-700">
                Each case is marked by whether it was booked in priority order — the order of the
                Priority Waitlist for this surgeon — and, if not, why. A mark is about that case
                only: holding a patient back never changes the marks on the cases behind them. A
                patient held back with no reason recorded is noted on the slate instead. The marks
                and the note are written to the slate CSV.
              </p>
              <div className="mt-3">
                {/* Nothing is ever placed by hand here, so the two marks that
                    describe a hand placement cannot occur. */}
                <BookingOrderLegend />
              </div>
              {patientsNeedingReason.length > 0 && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-900">
                  <p className="font-semibold">
                    {patientsNeedingReason.length === 1
                      ? "1 patient was moved by hand with no reason recorded"
                      : `${patientsNeedingReason.length} patients were moved by hand with no reason recorded`}
                  </p>
                  <p className="mt-1 text-rose-800">Choose a reason for each to clear it.</p>
                  <div className="mt-2 flex flex-col gap-2">
                    {patientsNeedingReason.map(({ item, what }) => (
                      <div
                        key={`needs-reason-${item.caseId}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sand-800"
                      >
                        <span>
                          <span className="font-semibold text-slateBlue-900">{item.displayLabel}</span>
                          <span className="ml-1.5 text-[10px] uppercase tracking-wider text-sand-400">
                            {item.caseId}
                          </span>
                          <span className="ml-2 text-sand-600">{what}</span>
                        </span>
                        <OrderReasonEditor
                          label="Reason"
                          reason={orderReasons[item.caseId]}
                          onChange={(reason) => updateOrderReason(item.caseId, reason)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
            <div
              className={`mt-6 grid items-start gap-4 ${
                slates.length === 3 ? "lg:grid-cols-3" : slates.length === 2 ? "lg:grid-cols-2" : ""
              }`}
            >
              {slates.map((slate, slateIndex) => {
                const orderedSlate = orderedSlates[slateIndex] ?? slate.selected;
                const slateDate = slate.dateISO;
                const accent = SLATE_ACCENTS[slateIndex % SLATE_ACCENTS.length];
                const schedule = buildCaseSchedule(orderedSlate, slateDate);
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
                const weekday = slateDate
                  ? new Date(`${slateDate}T00:00:00`).toLocaleDateString("en-CA", { weekday: "long" })
                  : "";
                return (
                  <div
                    key={`slate-${slateIndex}`}
                    aria-label={`Slate ${slateIndex + 1}${slateDate ? `, ${weekday} ${slateDate}` : ""}`}
                    className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-t-8 bg-white/80 shadow-sm ${accent.frame}`}
                  >
                    <div className={`px-4 pb-3 pt-3 ${accent.header}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-xs font-semibold tracking-wide ${accent.label}`}>
                            Slate {slateIndex + 1}
                          </p>
                          <h3 className="mt-0.5 text-lg font-semibold leading-tight text-slateBlue-900">
                            {weekday || "Unspecified date"}
                          </h3>
                          <p className="text-sm text-sand-700">
                            {slateDate || "No date set"} · {orderedSlate.length}{" "}
                            {orderedSlate.length === 1 ? "case" : "cases"}
                          </p>
                        </div>
                        <span
                          title={`${totalMinutes} / ${slate.blockMinutes} min used (incl. turnaround)`}
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            totalMinutes > slate.blockMinutes
                              ? "bg-rose-100 text-rose-700"
                              : utilizationPct >= 85
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {utilizationPct.toFixed(0)}% full
                        </span>
                      </div>
                      <BookingOrderTally
                        counts={countBookingOrder(
                          orderedSlate.map((item) => item.caseId),
                          bookingOrder
                        )}
                      />
                      {(putOffCountByDate[slateDate] ?? 0) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-rose-700">
                          {unexplainedPutOffNote(putOffCountByDate[slateDate])}
                        </p>
                      )}
                      <div className="mt-3">
                        <CapacityBar totalMinutes={totalMinutes} blockMinutes={slate.blockMinutes} />
                        <p className="mt-1 text-xs text-sand-600">
                          Starts {formatMinutesToTime(slateStart)} · {totalMinutes} /{" "}
                          {slate.blockMinutes} min ({surgicalMinutes} surgical + {turnaroundMinutes}{" "}
                          turnaround)
                        </p>
                        <p
                          className="text-xs text-sand-600"
                          title="Sum of case priority scores in this slate. Higher means more urgent, more overdue cases are included."
                        >
                          Total priority {totalPriorityScore.toFixed(1)}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-sand-600">Export:</span>
                        <button
                          type="button"
                          onClick={() => downloadSlateCsv(slateIndex)}
                          aria-label="Export slate CSV"
                          className="rounded-lg bg-slateBlue-700 px-3 py-1 text-xs font-semibold text-white"
                        >
                          Slate CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadMappingCsv(slateIndex)}
                          aria-label="Export case mapping"
                          className="rounded-lg border border-slateBlue-200 bg-white px-3 py-1 text-xs font-semibold text-slateBlue-700"
                        >
                          Case mapping
                        </button>
                      </div>
                    </div>

                    <div
                      className={`flex min-h-[8rem] flex-1 flex-col gap-2 border-2 border-dashed p-2 transition-colors ${
                        dragOverSlate === slateIndex && dragState?.slateIndex !== slateIndex
                          ? "border-slateBlue-400 bg-slateBlue-50/60"
                          : "border-transparent"
                      }`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setDragOverSlate(slateIndex);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverSlate(slateIndex);
                      }}
                      onDrop={(event) => handleDropOnSlate(event, slateIndex)}
                    >
                      {orderedSlate.length === 0 && (
                        <p className="m-auto text-xs text-sand-500">Drop patients here</p>
                      )}
                      {schedule.map(({ item, start, end, tatAfter, tatEnd }, index) => (
                        <Fragment key={item.caseId}>
                          <div
                            draggable
                            onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                            onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                            onDragEnd={handleDragEnd}
                            className={`rounded-xl border border-l-4 border-sand-200 bg-white px-3 py-2 text-sm shadow-sm cursor-grab active:cursor-grabbing ${accent.card} ${
                              draggingCaseId === item.caseId ? "opacity-40" : ""
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs tracking-wide text-sand-500">
                                #{index + 1} · {formatMinutesToTime(start)}–{formatMinutesToTime(end)}
                              </p>
                              <span
                                title="Priority score: higher means more urgent."
                                className="shrink-0 rounded-full bg-slateBlue-50 px-2 py-0.5 text-[11px] text-slateBlue-700"
                              >
                                Priority {item.priorityScore.toFixed(2)}
                              </span>
                            </div>
                            <p className="font-semibold text-slateBlue-900">{item.displayLabel}</p>
                            <p className="text-[10px] uppercase tracking-wider text-sand-400">
                              {item.caseId} · Surgeon {item.surgeonId}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-sand-700">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${urgencyChipClasses(
                                  item.benchmarkWeeks
                                )}`}
                              >
                                {item.benchmarkWeeks}w
                              </span>
                              {item.timeToTargetDays < 0 && (
                                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">
                                  {Math.abs(item.timeToTargetDays)}d overdue
                                </span>
                              )}
                              <BookingOrderBadge order={bookingOrder[item.caseId]} />
                              {movedCaseIds[item.caseId] && (
                                <span
                                  title="Manually repositioned from the suggested order"
                                  className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800"
                                >
                                  ↕ Moved
                                </span>
                              )}
                              {clinicalFlagDefinitions
                                .filter((flag) => item.flags?.[flag.key])
                                .map((flag) => (
                                  <span
                                    key={`${item.caseId}-${flag.key}`}
                                    className="rounded-full bg-sand-100 px-2 py-0.5"
                                  >
                                    {flag.label}
                                  </span>
                                ))}
                              {item.inpatient && (
                                <span className="rounded-full bg-sand-200 px-2 py-0.5 text-sand-800">
                                  Inpatient
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-sand-700">
                              Time to target {item.timeToTargetDays}d
                            </p>
                            {item.procedureName && (
                              <p className="text-xs text-sand-600">{item.procedureName}</p>
                            )}
                            {item.unavailableUntil && (
                              <p className="text-xs text-sand-600">
                                Unavailable until {item.unavailableUntil}
                              </p>
                            )}
                            <label className="mt-1 flex items-center gap-2 text-xs text-sand-700">
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
                            {(orderReasons[item.caseId] ||
                              (activePlacements[item.caseId] === slateDate &&
                                bookingOrder[item.caseId]?.status !== "fifo")) && (
                              <div className="mt-2 text-xs">
                                <OrderReasonEditor
                                  label="Reason for booking out of order"
                                  reason={orderReasons[item.caseId]}
                                  onChange={(reason) => updateOrderReason(item.caseId, reason)}
                                />
                              </div>
                            )}
                            <details className="mt-1 text-xs text-sand-700">
                              <summary className="cursor-pointer select-none font-semibold text-slateBlue-700">
                                Flags, availability, remove
                              </summary>
                              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
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
                              <label className="mt-2 flex flex-wrap items-center gap-2">
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
                                className="mt-2 rounded-lg border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-sand-800"
                              >
                                Remove from suggested slates
                              </button>
                            </details>
                          </div>
                          {tatAfter && (
                            <div className="flex items-center gap-2 px-2 text-[11px] text-sand-500">
                              <span className="h-px flex-1 bg-sand-200" />
                              <span className="rounded-full bg-sand-100 px-2 py-0.5 font-medium">
                                ↻ 30-min turnaround · ready {formatMinutesToTime(tatEnd)}
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
              className="rounded-lg border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
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
                    {patientsNeedingReason.some((entry) => entry.item.caseId === item.caseId) && (
                      <span
                        title="Moved by hand with no reason recorded. Open this row to choose one."
                        className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700"
                      >
                        Reason needed
                      </span>
                    )}
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
                      {(removedFromSlateSuggestions[item.caseId] || orderReasons[item.caseId]) && (
                        <div className="mt-2 flex justify-start">
                          <OrderReasonEditor
                            label="Reason for holding back"
                            reason={orderReasons[item.caseId]}
                            onChange={(reason) => updateOrderReason(item.caseId, reason)}
                          />
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {removedFromSlateSuggestions[item.caseId] ? (
                          <button
                            type="button"
                            onClick={() => restoreToSuggestedSlates(item.caseId)}
                            className="rounded-lg border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                          >
                            Restore to suggested slates
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeFromSuggestedSlates(item.caseId)}
                            className="rounded-lg border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
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
              <div className="rounded-xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
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
              className="rounded-lg bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
            >
              Export long-waiters PDF
            </button>
            <button
              type="button"
              onClick={downloadLongWaitersCsv}
              className="rounded-lg border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Export long-waiters CSV
            </button>
          </div>
        </div>

        {longWaiters.total === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
            No patients are over target.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {longWaiters.groups.map((group) => (
              <div key={group.label} className="rounded-xl border border-sand-200 bg-white/70 p-4">
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
                className="rounded-lg border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-slateBlue-700"
              >
                Save group
              </button>
            </div>
          </div>
        </div>
      </section>

        </>
      )}

      <footer className="mt-4 border-t border-sand-200 pt-6 text-xs leading-6 text-sand-600">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="max-w-3xl">
            <p>
              <span className="font-semibold text-sand-800">How the priority score works:</span>{" "}
              each case scores its benchmark urgency weight (2w = 5, 4w = 4, 6w = 3, 12w = 2, 26w
              = 1) multiplied by how far it has waited toward its target, so the score climbs every
              day and keeps rising once a patient is past target. Cases already past target are
              placed on the slate first; the rest of the block is filled to do as many further
              cases as possible.
            </p>
            <p className="mt-2">
              Nothing you upload leaves this computer: processing happens in your browser, and
              exported slates use an opaque case code (e.g. C-001) unless you opt to include names.
            </p>
          </div>
          <a
            href="/guide"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 font-semibold text-slateBlue-700 hover:underline"
          >
            User guide ↗
          </a>
        </div>
        <p className="mt-3 max-w-4xl text-sand-500">
          &copy; 2026 Dr. Jonathan Collins. All rights reserved. SlateBuilder Pro was developed by
          Dr. Jonathan Collins for BC Women&apos;s Hospital Surgical Services pilot use, with
          AI-assisted development tools. It is provided as a scheduling aid for pilot evaluation
          only — always verify case details, priority scores, and slate assignments before relying
          on them clinically.
        </p>
      </footer>

      {showMetrics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slateBlue-900">Advanced Metrics</h2>
              <button
                type="button"
                onClick={() => setShowMetrics(false)}
                className="rounded-lg border border-sand-300 px-3 py-1 text-xs font-semibold text-slateBlue-700"
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
      {reasonPrompt &&
        (() => {
          const item = filteredCasesWithOverrides.find((c) => c.caseId === reasonPrompt.caseId);
          if (!item) return null;
          return (
            <OrderReasonPrompt
              patientLabel={item.displayLabel}
              caseId={item.caseId}
              what={reasonPrompt.what}
              reason={orderReasons[item.caseId]}
              onChange={(reason) => updateOrderReason(item.caseId, reason)}
              onClose={() => setReasonPrompt(null)}
            />
          );
        })()}
    </main>
  );
}
