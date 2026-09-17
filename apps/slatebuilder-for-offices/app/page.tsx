"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  canBindNotesFile,
  ensureHandlePermission,
  forgetNotesHandle,
  NotesFileHandle,
  pickNotesFileForOpening,
  pickNotesFileForSaving,
  readNotesHandle,
  recallNotesHandle,
  rememberNotesHandle,
  writeNotesHandle,
} from "./notesStorage";
import {
  downloadSlatePdf,
  downloadAllSlatesPdf,
  downloadWaitlistPdf,
  SlatePdfCase,
  SlatePdfOptions,
  WaitlistPdfRow,
} from "@slatebuilder/core/slatePdf";
import {
  AnnotationsFile,
  ANNOTATIONS_KIND,
  AnnotationTimes,
  applyAnnotations,
  applyDefaultDuration,
  applyFlagOverrides,
  applyUnavailableOverrides,
  BENCHMARK_WEEKS_ORDER,
  buildCaseSchedule,
  caseFitsInSlate,
  checkImportedWaitlist,
  ImportCheck,
  summarizeImport,
  ClinicalFlagKey,
  collectAnnotations,
  createSessionKey,
  decryptJsonWithSessionKey,
  encryptJsonWithSessionKey,
  isClearedAnnotation,
  openSessionKey,
  sessionKeyCanRead,
  SessionKey,
  DefaultDurations,
  fingerprintWaitlist,
  isAnnotationsFile,
  isEncryptedEnvelope,
  mergeAnnotations,
  MIN_PASSPHRASE_LENGTH,
  PatientAnnotation,
  stablePatientKey,
  formatMinutesToTime,
  getBlockMinutes,
  getBlockStartMinutes,
  normalizeDateOnly,
  optimizeSlatesForDates,
  parseCsv,
  PatientCase,
  PriorityMode,
  ScoredCase,
  clinicalFlagDefinitions,
  serializeCsv,
  csvEscape,
  sortForSlate,
  sortForWaitlist,
  toLocalDateOnly,
  scoreCases,
  isAvailableOnDate,
  urgencyChipClasses,
  TURNAROUND_MINUTES,
  MAX_CASES_PER_SLATE,
} from "@slatebuilder/core";

type SpreadsheetRow = Record<string, string | number | boolean | null | undefined>;

// A drag is either a case picked up from the waitlist, or a case picked up
// from a specific slate (used to support cross-container drag-and-drop).
type DragState = { kind: "slate"; slateIndex: number; caseId: string } | { kind: "waitlist"; caseId: string };

type OptimizeReport = {
  perSlate: {
    slateIndex: number;
    dateISO: string;
    beforePct: number;
    afterPct: number;
    added: string[];
    removed: string[];
  }[];
  // Over-target cases that could not be fit into any unlocked slate during
  // this pass (e.g. every slate is already full). Optimize Utilization never
  // bumps an over-target case in favor of a not-yet-overdue one, but a case
  // this large/constrained genuinely not fitting anywhere is still possible
  // and must be surfaced, not left for staff to notice later on their own.
  unplacedOverdue: string[];
};

type OfficeTab = "setup" | "slates" | "waitlist" | "long";
// The only thing remembered between page loads is which tab you were on. No
// patient information is written to browser storage of any kind: the uploaded
// waitlist lives in memory for as long as the tab is open, and nowhere else.
const OFFICE_TAB_KEY = "slatebuilder-office-tab";
// Highest notes revision seen on this machine. A number, not patient data.
const NOTES_REVISION_KEY = "slatebuilder-office-notes-revision";
// The newest notes timestamp this computer has worked with. Timestamps rather
// than revision numbers: autosave bumps the revision on every write, so "this
// file is revision 12 and you have seen 340" says nothing useful about age,
// whereas "saved three days before the version you already have" always does.
const NOTES_SEEN_AT_KEY = "slatebuilder-office-notes-seen-at";
// How long editing has to stop before an autosave fires. Long enough that
// typing a case length is one save rather than three; short enough that
// walking away from the desk leaves nothing unwritten.
const AUTOSAVE_DELAY_MS = 2500;
const AUTHOR_LABEL_KEY = "slatebuilder-office-author";

function downloadTextFile(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadFile(filename: string, contents: string) {
  downloadTextFile(filename, contents, "text/csv");
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
      className={`rounded-2xl border-2 px-5 py-4 ${
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
          className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white ${
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

// Whether the notes on screen have reached the file, shown in the header so
// it is answerable from any tab rather than only from Setup.
//
// The three states say different things and are worth distinguishing: a linked
// file writes itself and only needs reporting, an unlinked one needs a
// deliberate click, and a file nobody has unlocked yet needs a passphrase
// before either can happen.
function NotesSaveState({
  busy,
  dirty,
  count,
  linked,
  unlocked,
  savedAt,
  onSave,
}: {
  busy: boolean;
  dirty: boolean;
  count: number;
  linked: boolean;
  unlocked: boolean;
  savedAt: string | null;
  onSave: () => void;
}) {
  if (count === 0 && !savedAt) return null;

  if (busy) {
    return <span className="font-semibold text-sand-700">Saving notes…</span>;
  }

  if (dirty) {
    const label = !unlocked
      ? "Set a passphrase to save"
      : linked
        ? "Save now"
        : `Save ${count} note${count === 1 ? "" : "s"}`;
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unsaved notes
        </span>
        <button
          type="button"
          onClick={onSave}
          className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
        >
          {label}
        </button>
      </span>
    );
  }

  if (!savedAt) return null;
  const at = new Date(savedAt);
  const when = Number.isFinite(at.getTime())
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <span
      title={linked ? "Notes are written to the linked file as you work." : undefined}
      className="inline-flex items-center gap-1.5 font-semibold text-emerald-700"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Notes saved{when ? ` ${when}` : ""}
    </span>
  );
}

/** Order-independent rendering of a note set, for "has anything changed?". */
function signatureOf(annotations: Record<string, PatientAnnotation>): string {
  return JSON.stringify(
    Object.keys(annotations)
      .sort()
      .map((key) => [key, annotations[key]])
  );
}

// Numbered heading for the Setup tab. The numbers are not decoration: the
// three steps are genuinely sequential — a waitlist has to be loaded before
// notes can be matched against it, and the rules affect what the slates look
// like once both are in.
function StepHeading({
  step,
  title,
  optional = false,
}: {
  step: number;
  title: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slateBlue-700 text-xs font-semibold text-white">
        {step}
      </span>
      <h2 className="text-lg font-semibold text-slateBlue-900">{title}</h2>
      {optional && (
        <span className="rounded-full border border-sand-300 px-2 py-0.5 text-[11px] font-semibold text-sand-600">
          Optional
        </span>
      )}
    </div>
  );
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

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path
        d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6m-7.5 0 .6 9.4a1.5 1.5 0 0 0 1.5 1.4h5.8a1.5 1.5 0 0 0 1.5-1.4L15.5 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  // Aggregate sanity checks on the file that just loaded, and whether the user
  // has said they have read them. Acknowledgement is deliberately not
  // remembered: it belongs to one import, and the next upload earns a fresh
  // look.
  const [importChecks, setImportChecks] = useState<ImportCheck[]>([]);
  const [importChecksRead, setImportChecksRead] = useState(false);
  // How the app read the file, stated plainly. Always shown after an upload,
  // never conditional — see summarizeImport() for why a silent receipt catches
  // what a threshold cannot.
  const [importSummary, setImportSummary] = useState<string | null>(null);
  // Confirms a fresh upload succeeded ("✓ N patients loaded"); only set right
  // after handleUpload, never after the sessionStorage-restore path re-parses
  // the same csvText on reload (see justUploadedRef below).
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const justUploadedRef = useRef(false);
  // Bumped alongside every setCsvText from an upload. Without it, re-uploading
  // a file whose contents are byte-identical leaves csvText unchanged, React
  // skips the parse effect, and the upload appears to do nothing at all — no
  // confirmation line, no import checks, nothing. Set in the same handler as
  // the text so the two land in one render.
  const [uploadNonce, setUploadNonce] = useState(0);
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({});
  const [unavailableOverrides, setUnavailableOverrides] = useState<Record<string, string>>({});
  const [flagOverrides, setFlagOverrides] = useState<
    Record<string, Partial<Record<ClinicalFlagKey, boolean>>>
  >({});
  const [removedFromSlateSuggestions, setRemovedFromSlateSuggestions] = useState<
    Record<string, boolean>
  >({});
  const [removedFromWaitlist, setRemovedFromWaitlist] = useState<Record<string, boolean>>({});
  const [defaultDurations, setDefaultDurations] = useState<DefaultDurations>({
    hysteroscopy: 30,
    laparoscopy: 60,
    hysterectomy: 180,
    other: 90,
  });
  const [defaultsSavedAt, setDefaultsSavedAt] = useState<string | null>(null);
  const [priorityMode, setPriorityMode] = useState<PriorityMode>("urgency_then_ttt");
  const [slateCount, setSlateCount] = useState(2);
  const [slateDates, setSlateDates] = useState<string[]>(() => {
    const today = new Date();
    return [21, 35, 49].map((offset) => {
      const next = new Date(today);
      next.setDate(today.getDate() + offset);
      return toLocalDateOnly(next);
    });
  });
  const [orderedSlates, setOrderedSlates] = useState<ScoredCase[][]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  // UI-only drag feedback: which drop zone is currently hovered, and which
  // case is being lifted. Not persisted — purely visual affordance.
  const [dragOverTarget, setDragOverTarget] = useState<
    { kind: "slate"; slateIndex: number } | { kind: "waitlist" } | null
  >(null);
  const [draggingCaseId, setDraggingCaseId] = useState<string | null>(null);
  // Case IDs the user has manually repositioned via drag (cross-slate move or
  // intra-slate reorder), so their card can show a "moved from suggestion" hint.
  const [movedCaseIds, setMovedCaseIds] = useState<Record<string, true>>({});
  const [orderedSlateCaseIds, setOrderedSlateCaseIds] = useState<string[][]>([]);
  // Keyed by dateISO (not array position) so lock/collapse state stays attached
  // to "the slate for that date" even if the results array shifts.
  const [lockedSlates, setLockedSlates] = useState<Record<string, boolean>>({});
  const [collapsedSlates, setCollapsedSlates] = useState<Record<string, boolean>>({});
  const [waitlistPanelCollapsed, setWaitlistPanelCollapsed] = useState(true);
  const [optimizeReport, setOptimizeReport] = useState<OptimizeReport | null>(null);
  const [includeNamesInExports, setIncludeNamesInExports] = useState(false);
  const [activeTab, setActiveTab] = useState<OfficeTab>("setup");
  const [expandedCaseIds, setExpandedCaseIds] = useState<Record<string, boolean>>({});
  const [waitlistQuery, setWaitlistQuery] = useState("");
  const [waitlistOverdueOnly, setWaitlistOverdueOnly] = useState(false);
  const [waitlistUnslatedOnly, setWaitlistUnslatedOnly] = useState(true);
  // Saving and reloading the office's own notes (an encrypted file on this
  // computer). Nothing here talks to a server: the passphrase and the decrypted
  // notes exist only in this tab's memory.
  const [notesPassphrase, setNotesPassphrase] = useState("");
  const [notesPassphraseConfirm, setNotesPassphraseConfirm] = useState("");
  const [notesFile, setNotesFile] = useState<File | null>(null);
  const [notesStatus, setNotesStatus] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesBusy, setNotesBusy] = useState(false);
  // Which of the two notes actions produced the current message, so feedback
  // appears in the card the user just used rather than in both of them.
  const [notesScope, setNotesScope] = useState<"save" | "load" | null>(null);
  // The key for the notes file currently open, derived once when that file is
  // created or unlocked and held only in memory. It is non-extractable, so it
  // cannot be read back out; the passphrase it came from is not kept at all.
  // Closing the tab ends the session and the key with it.
  const [sessionKey, setSessionKey] = useState<SessionKey | null>(null);
  // What the notes looked like when they were last written to the file, and
  // when that was. The comparison against the live state is what "unsaved"
  // means anywhere in the app.
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [notesSavedAt, setNotesSavedAt] = useState<string | null>(null);
  // Guards against a manual save and an autosave overlapping on one file.
  const savingRef = useRef(false);
  // Free-text label recorded against each edit and each save, so a merged file
  // can say who changed what. Remembered per machine; it names a role, not a
  // person's health information.
  const [authorLabel, setAuthorLabel] = useState("");
  // When each patient's notes last changed, keyed by case code. Seeded from a
  // loaded file so that saving preserves real edit times rather than restamping
  // everything with the moment of the save.
  const [annotationTimes, setAnnotationTimes] = useState<AnnotationTimes>({});
  // Provenance of the notes currently on screen: what we loaded, and what the
  // file said when we loaded it. Drives the revision counter and the
  // someone-else-saved-since check.
  // The one file this computer writes notes to, when the browser supports it.
  const [notesHandle, setNotesHandle] = useState<NotesFileHandle | null>(null);
  const [canBindFile, setCanBindFile] = useState(false);
  const [loadedNotes, setLoadedNotes] = useState<{
    revision: number;
    savedBy?: string;
    updatedAt: string;
    fingerprint?: string;
    patientCount?: number;
  } | null>(null);
  // Tracks the last "structural" signature (case-id-set + active dates +
  // priority mode) that the slate composition was auto-generated from, so
  // manual edits (drag, lock, remove/restore, duration/flag tweaks) are never
  // silently overwritten by the optimizer — only a real structural change
  // (new upload, date/count change, or an explicit priority-mode toggle)
  // regenerates the suggested composition.
  const compositionSeedRef = useRef<string>("");
  // Per-patient notes waiting for a file to finish parsing so they can be
  // re-keyed onto the new case codes. Set either by an upload (carrying the
  // current screen's edits forward) or by loading a saved notes file.
  const pendingAnnotationsRef = useRef<Record<string, PatientAnnotation> | null>(null);

  useEffect(() => {
    if (!csvText) return;
    const result = parseCsv(csvText);
    setCases(result.cases);
    setWarnings(result.warnings);
    setImportChecks(checkImportedWaitlist(result));
    setImportChecksRead(false);
    setImportSummary(result.cases.length > 0 ? summarizeImport(result.cases).line : null);
    if (justUploadedRef.current) {
      justUploadedRef.current = false;

      // Case codes are positional (C-001 = row 1), so a new file's codes mean
      // new patients. Re-key each patient's notes onto the new codes by
      // matching their identity (PHN, else name); notes for patients no longer
      // on the list are dropped, and the slate composition always rebuilds.
      const pending = pendingAnnotationsRef.current;
      pendingAnnotationsRef.current = null;
      let carried = 0;
      if (pending) {
        const applied = applyAnnotations(result.cases, pending);
        carried = applied.matched;
        setDurationOverrides(applied.durationOverrides);
        setUnavailableOverrides(applied.unavailableOverrides);
        setFlagOverrides(applied.flagOverrides);
        setRemovedFromSlateSuggestions(applied.removedFromSlateSuggestions);
        setRemovedFromWaitlist(applied.removedFromWaitlist);
        setAnnotationTimes(applied.times);
        setMovedCaseIds({});
        setOrderedSlates([]);
        setOrderedSlateCaseIds([]);
        setOptimizeReport(null);
        setDragState(null);
        setDragOverTarget(null);
        setDraggingCaseId(null);
        compositionSeedRef.current = "";
      }

      const skipped = result.warnings.length > 0 ? ` · ${result.warnings.length} row${result.warnings.length === 1 ? "" : "s"} skipped or flagged, see below` : "";
      const kept = carried > 0 ? ` · notes kept for ${carried} returning patient${carried === 1 ? "" : "s"}` : "";
      setUploadSummary(`✓ ${result.cases.length} patient${result.cases.length === 1 ? "" : "s"} loaded${kept}${skipped}`);
    }
  }, [csvText, uploadNonce]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AUTHOR_LABEL_KEY);
      if (stored) setAuthorLabel(stored);
    } catch {
      // no stored label; the field simply starts empty
    }
  }, []);

  // Detect the capability rather than the browser, and re-attach to the file
  // this computer was last bound to. Re-attaching does not read the file or
  // prompt: permission is requested only when a save or load actually happens.
  useEffect(() => {
    const supported = canBindNotesFile();
    setCanBindFile(supported);
    if (!supported) return;
    let cancelled = false;
    void recallNotesHandle().then((handle) => {
      if (!cancelled && handle) setNotesHandle(handle);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // A reload discards the uploaded waitlist by design — nothing about it is
  // written to browser storage — so warn before one is lost by accident.
  useEffect(() => {
    if (cases.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cases.length]);

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

  const officeCases = useMemo(() => {
    return cases.map((item) =>
      applyUnavailableOverrides(
        applyFlagOverrides(applyDefaultDuration(item, defaultDurations), flagOverrides),
        unavailableOverrides
      )
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
    return officeCasesWithOverrides.filter(
      (item) => !removedFromSlateSuggestions[item.caseId] && !removedFromWaitlist[item.caseId]
    );
  }, [officeCasesWithOverrides, removedFromSlateSuggestions, removedFromWaitlist]);

  // Cases still meaningfully "on the waitlist" — excludes patients explicitly
  // removed from the waitlist entirely (they remain visible, greyed out, in the
  // waitlist list itself, but shouldn't count toward stats/histograms/long-waiters).
  const activeOfficeCases = useMemo(() => {
    return officeCasesWithOverrides.filter((item) => !removedFromWaitlist[item.caseId]);
  }, [officeCasesWithOverrides, removedFromWaitlist]);

  // Patients with a period of unavailability, for the sub-list at the bottom
  // of the Priority Waitlist. They stay in the main waitlist too — this is
  // purely a visibility grouping so staff can spot upcoming holds at a glance.
  const unavailableOfficeCases = useMemo(() => {
    return activeOfficeCases
      .filter((item) => Boolean(item.unavailableUntil))
      .sort((a, b) => (a.unavailableUntil ?? "").localeCompare(b.unavailableUntil ?? ""));
  }, [activeOfficeCases]);

  const officeSurgeons = useMemo(() => {
    return Array.from(new Set(officeCases.map((item) => item.surgeonId))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [officeCases]);

  const sortWaitlistByPriority = (items: PatientCase[]) => sortForWaitlist(items, priorityMode);

  const sortSlateByPriority = (items: ScoredCase[]) => sortForSlate(items, priorityMode);

  // The configured, non-empty slate dates, in order. This is the single
  // source of truth for "how many slate slots exist and which date each one
  // is" — orderedSlates/orderedSlateCaseIds are always indexed against this,
  // NOT against `slates` below (see its comment for why those two can
  // diverge).
  const activeSlateDates = useMemo(
    () => slateDates.slice(0, slateCount).filter(Boolean),
    [slateDates, slateCount]
  );

  // The optimizer's own suggestion, keyed by dates. IMPORTANT: this array can
  // be SHORTER than activeSlateDates -- optimizeSlatesForDates stops once it
  // runs out of cases to place, so a trailing configured date with nothing
  // left to schedule simply isn't represented here. Never use slates.length
  // or slates[i] as the source of truth for how many slate slots exist or
  // which date slot i is; use activeSlateDates for that instead.
  const slates = useMemo(() => {
    if (slateEligibleCases.length === 0) return null;
    const dates = activeSlateDates.map((date) => new Date(`${date}T00:00:00`));
    if (dates.length === 0) return null;
    return optimizeSlatesForDates(slateEligibleCases, dates);
  }, [slateEligibleCases, activeSlateDates]);

  // One entry per configured slate slot (always activeSlateDates.length long,
  // unlike `slates`), carrying just enough to render/target a slate card even
  // when the optimizer memo never reached that index.
  const slateSlots = useMemo(() => {
    return activeSlateDates.map((dateISO, i) => {
      const fromOptimizer = slates?.[i];
      // Only trust the optimizer entry at this index if its date actually
      // matches -- optimizeSlatesForDates can skip a date entirely (not just
      // stop early) if every remaining case is unavailable that day, which
      // would otherwise shift slates[i] out of alignment with slot i.
      if (fromOptimizer && fromOptimizer.dateISO === dateISO) {
        return { dateISO, blockMinutes: fromOptimizer.blockMinutes, selected: fromOptimizer.selected };
      }
      const date = new Date(`${dateISO}T00:00:00`);
      return { dateISO, blockMinutes: getBlockMinutes(date), selected: [] as ScoredCase[] };
    });
  }, [activeSlateDates, slates]);

  // A slate's composition is auto-generated only on a real structural change:
  // a new upload (the case-id set changes), the configured dates/count change,
  // or the priority-rule toggle. Any other edit (drag, lock, duration/flag
  // tweaks, remove/restore) mutates orderedSlates/orderedSlateCaseIds directly
  // and is never silently overwritten by re-running the optimizer.
  const activeDatesKey = useMemo(() => activeSlateDates.join("|"), [activeSlateDates]);
  const caseIdSetKey = useMemo(
    () =>
      officeCasesWithOverrides
        .map((c) => c.caseId)
        .sort()
        .join(","),
    [officeCasesWithOverrides]
  );

  useEffect(() => {
    const seedKey = `${caseIdSetKey}::${activeDatesKey}::${priorityMode}`;
    if (seedKey === compositionSeedRef.current) return;
    compositionSeedRef.current = seedKey;
    setLockedSlates({});
    setCollapsedSlates({});
    if (!slates) {
      setOrderedSlates([]);
      setOrderedSlateCaseIds([]);
      return;
    }
    const nextOrdered = slates.map((item) => sortSlateByPriority(item.selected));
    setOrderedSlates(nextOrdered);
    setOrderedSlateCaseIds(nextOrdered.map((slate) => slate.map((item) => item.caseId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseIdSetKey, activeDatesKey, priorityMode, slates]);

  const selectedCaseIds = useMemo(() => {
    const ids = new Set<string>();
    orderedSlates.forEach((slate) => {
      slate.forEach((item) => ids.add(item.caseId));
    });
    return ids;
  }, [orderedSlates]);

  const orderedByUrgency = useMemo(() => {
    return sortWaitlistByPriority(officeCasesWithOverrides);
  }, [officeCasesWithOverrides, priorityMode]);

  const remainingByUrgency = useMemo(() => {
    return orderedByUrgency.filter(
      (item) => !selectedCaseIds.has(item.caseId) && !removedFromWaitlist[item.caseId]
    );
  }, [orderedByUrgency, selectedCaseIds, removedFromWaitlist]);

  const blockMinutes = useMemo(() => {
    if (!slateDates[0]) return 0;
    const date = new Date(`${slateDates[0]}T00:00:00`);
    return getBlockMinutes(date);
  }, [slateDates]);

  const officeStats = useMemo(() => {
    const overdue = activeOfficeCases.filter((item) => item.timeToTargetDays < 0).length;
    const totalMinutes = activeOfficeCases.reduce(
      (sum, item) => sum + item.estimatedDurationMin,
      0
    );
    const urgent = activeOfficeCases.filter((item) => item.benchmarkWeeks <= 6).length;
    return {
      totalCases: activeOfficeCases.length,
      overdue,
      urgent,
      totalHours: totalMinutes / 60,
    };
  }, [activeOfficeCases]);

  // Histogram data: per benchmark bucket, split patients into under-/over-target
  // bands at the ±50%-of-target threshold.
  const waitlistOverview = useMemo<OverviewBucket[]>(() => {
    const buckets: OverviewBucket[] = BENCHMARK_WEEKS_ORDER.map((weeks) => ({
      label: `${weeks}w`,
      wellUnder: 0,
      approaching: 0,
      recentlyOver: 0,
      wellOver: 0,
      total: 0,
    }));
    const indexOf = new Map(BENCHMARK_WEEKS_ORDER.map((weeks, i) => [weeks, i]));
    activeOfficeCases.forEach((item) => {
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
  }, [activeOfficeCases]);

  // Long-waiters: every case past target, grouped by benchmark class, most
  // overdue first within each class.
  const longWaiters = useMemo(() => {
    const groups = BENCHMARK_WEEKS_ORDER.map((weeks) => ({
      weeks,
      label: `${weeks}w`,
      cases: [] as PatientCase[],
    }));
    const indexOf = new Map(BENCHMARK_WEEKS_ORDER.map((weeks, i) => [weeks, i]));
    activeOfficeCases
      .filter((c) => c.timeToTargetDays < 0)
      .forEach((c) => {
        const i = indexOf.get(c.benchmarkWeeks);
        if (i !== undefined) groups[i].cases.push(c);
      });
    groups.forEach((g) => g.cases.sort((a, b) => a.timeToTargetDays - b.timeToTargetDays));
    const total = groups.reduce((sum, g) => sum + g.cases.length, 0);
    return { groups, total };
  }, [activeOfficeCases]);

  // ---- Saving the office's own notes to this computer ----------------------
  //
  // There is no server and no account. The only thing that can outlive the tab
  // is a file the user deliberately saves: their accumulated notes about
  // patients, encrypted with a passphrase only they know. The uploaded waitlist
  // is never part of it — the hospital's file is the list, and it is re-sent
  // every week.

  // Records that this patient's notes just changed. Called from every edit
  // site; the timestamp is what a later merge resolves conflicts with.
  const touchAnnotations = (caseId: string) => {
    const at = new Date().toISOString();
    setAnnotationTimes((prev) => ({
      ...prev,
      [caseId]: { at, by: authorLabel.trim() || undefined },
    }));
  };

  // The notes as they stand right now, keyed by patient identity. Collected
  // once and reused for the count, the unsaved check and the save itself, so
  // all three can never disagree about what is on screen.
  const currentAnnotations = useMemo(
    () =>
      collectAnnotations(
        cases,
        {
          durationOverrides,
          unavailableOverrides,
          flagOverrides,
          removedFromSlateSuggestions,
          removedFromWaitlist,
        },
        annotationTimes
      ),
    [
      cases,
      durationOverrides,
      unavailableOverrides,
      flagOverrides,
      removedFromSlateSuggestions,
      removedFromWaitlist,
      annotationTimes,
    ]
  );

  // Cleared entries are tombstones -- they exist so that merging with an older
  // file cannot resurrect notes someone deliberately removed. They are not
  // notes anyone has, so they are not counted as such on screen.
  const annotationsCount = useMemo(
    () => Object.values(currentAnnotations).filter((entry) => !isClearedAnnotation(entry)).length,
    [currentAnnotations]
  );

  // A stable rendering of the notes, compared against the last thing written
  // to the file to decide whether anything is outstanding. Keys are sorted so
  // that collection order can never make identical notes look different.
  const annotationsSignature = useMemo(() => signatureOf(currentAnnotations), [currentAnnotations]);

  const notesDirty = annotationsCount > 0 && annotationsSignature !== savedSignature;

  // The highest notes revision this machine has seen, kept in localStorage.
  // It is a counter, not patient information, so it can persist where the
  // notes themselves deliberately do not — and it is what lets the app notice
  // that the file being loaded is older than one already worked with here.
  const lastSeenRevision = (): number => {
    try {
      return Number(window.localStorage.getItem(NOTES_REVISION_KEY)) || 0;
    } catch {
      return 0;
    }
  };

  const rememberRevision = (revision: number) => {
    try {
      if (revision > lastSeenRevision()) {
        window.localStorage.setItem(NOTES_REVISION_KEY, String(revision));
      }
    } catch {
      // A browser with storage disabled simply loses the staleness check.
    }
  };

  // The newest notes this computer has worked with, by the time they were
  // saved rather than by revision number: autosave makes revisions climb
  // constantly, so only the clock says anything meaningful about which of two
  // files is older.
  const lastSeenAt = (): string => {
    try {
      return window.localStorage.getItem(NOTES_SEEN_AT_KEY) ?? "";
    } catch {
      return "";
    }
  };

  const rememberSeenAt = (iso: string) => {
    if (!iso) return;
    try {
      const seen = lastSeenAt();
      if (!seen || Date.parse(iso) > Date.parse(seen)) {
        window.localStorage.setItem(NOTES_SEEN_AT_KEY, iso);
      }
    } catch {
      // Storage disabled; the staleness check is simply unavailable.
    }
  };

  // Reasons to pause before loading a file. Deliberately excludes "these notes
  // were saved against a different waitlist", which is the normal weekly case
  // and would train people to click through the warning.
  const describeNotesConcerns = (file: AnnotationsFile): string[] => {
    const out: string[] = [];
    const seen = lastSeenAt();
    const incomingAt = file.updatedAt ?? "";
    if (seen && incomingAt && Date.parse(incomingAt) < Date.parse(seen)) {
      out.push(
        `These notes were saved on ${incomingAt.slice(0, 10)}, but this computer has already worked with a newer version saved on ${seen.slice(0, 10)}. This may be an older copy, and loading it could bring back notes that were since changed.`
      );
    }
    const savedAt = Date.parse(file.updatedAt ?? "");
    if (Number.isFinite(savedAt)) {
      const days = Math.floor((Date.now() - savedAt) / 86_400_000);
      if (days > 14) {
        out.push(`These notes were last saved ${days} days ago, on ${file.updatedAt.slice(0, 10)}.`);
      }
      if (savedAt > Date.now() + 86_400_000) {
        out.push(
          "These notes are dated in the future, which usually means the clock on the computer that saved them is wrong. Merging relies on these times being right."
        );
      }
    }
    if (annotationsCount > 0 && !loadedNotes) {
      out.push(
        `You have notes on screen for ${annotationsCount} patient${annotationsCount === 1 ? "" : "s"} that have not been saved. They will be combined with this file, keeping whichever is newer for each patient.`
      );
    }
    return out;
  };

  // Choose the single file this computer reads and writes notes to. Doing this
  // once means every later save overwrites that file instead of adding another
  // copy to Downloads — which is what stops an office accumulating several
  // notes files and loading the wrong one.
  const handleChooseNotesFile = async (mode: "open" | "create") => {
    setNotesError(null);
    setNotesStatus(null);
    setNotesScope(mode === "open" ? "load" : "save");
    const handle =
      mode === "open"
        ? await pickNotesFileForOpening()
        : await pickNotesFileForSaving(
            `slatebuilder-notes-${toLocalDateOnly(new Date())}.sbnotes`
          );
    if (!handle) return; // cancelled
    setNotesHandle(handle);
    setNotesFile(null);
    await rememberNotesHandle(handle);
    setNotesStatus(
      mode === "open"
        ? `Using ${handle.name}. Enter its passphrase and load it to bring in the notes.`
        : `Notes will be saved to ${handle.name} from now on, replacing it each time rather than adding another copy.`
    );
  };

  const handleUnbindNotesFile = async () => {
    await forgetNotesHandle();
    setNotesHandle(null);
    setNotesScope("save");
    // The key belonged to that file. Whatever is saved next is a new file and
    // needs its own passphrase, so autosave stops here too.
    setSessionKey(null);
    setSavedSignature(null);
    setNotesStatus(
      "No longer linked to a file. Saving will download a copy instead, and will ask for a passphrase for it."
    );
  };

  // Builds the file that would be saved right now, including provenance.
  const buildNotesFile = (revision: number): AnnotationsFile => ({
    v: 1,
    kind: ANNOTATIONS_KIND,
    updatedAt: new Date().toISOString(),
    revision,
    savedBy: authorLabel.trim() || undefined,
    waitlist:
      cases.length > 0
        ? { fingerprint: fingerprintWaitlist(cases), patientCount: cases.length }
        : undefined,
    annotations: collectAnnotations(
      cases,
      {
        durationOverrides,
        unavailableOverrides,
        flagOverrides,
        removedFromSlateSuggestions,
        removedFromWaitlist,
      },
      annotationTimes
    ),
    settings: { defaultDurations, priorityMode, slateCount },
  });

  /**
   * Writes the notes to the linked file, or downloads a copy when there is no
   * linked file.
   *
   * The passphrase is only ever asked for once per file: the first save of a
   * new file establishes the session key, and every save after that -- manual
   * or automatic -- uses it. `silent` is what autosave passes, so that a save
   * nobody asked for does not plant a status banner on the Setup tab.
   */
  const saveNotes = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (savingRef.current) return;
    if (!silent) {
      setNotesError(null);
      setNotesStatus(null);
      setNotesScope("save");
    }

    // First save of a brand-new file: this is the one moment a passphrase is
    // required, and the one moment it is worth confirming, since there is no
    // existing file to check it against.
    let session = sessionKey;
    if (!session) {
      if (silent) return;
      if (notesPassphrase.length < MIN_PASSPHRASE_LENGTH) {
        setNotesError(
          `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters. Several words together work well and are easier to remember.`
        );
        return;
      }
      if (notesPassphrase !== notesPassphraseConfirm) {
        setNotesError("The two passphrases do not match.");
        return;
      }
      try {
        session = await createSessionKey(notesPassphrase);
      } catch {
        setNotesError("Could not prepare the notes file for saving.");
        return;
      }
      setSessionKey(session);
      setNotesPassphrase("");
      setNotesPassphraseConfirm("");
    }

    savingRef.current = true;
    setNotesBusy(true);
    try {
      let baseRevision = loadedNotes?.revision ?? lastSeenRevision();
      let mine = currentAnnotations;
      let mergedInFirst = 0;

      // Writing to a shared file is the one case where saving can destroy
      // someone else's work: if a colleague saved after this session opened
      // the file, a plain overwrite erases everything they did. Re-read first,
      // and if the file has moved on, merge into it rather than over it.
      if (notesHandle && (await ensureHandlePermission(notesHandle, "readwrite"))) {
        let existingEnvelope: unknown = null;
        try {
          existingEnvelope = JSON.parse(await readNotesHandle(notesHandle));
        } catch {
          // A file that is empty or not JSON is one this session is about to
          // write for the first time. There is nothing to merge.
        }
        if (isEncryptedEnvelope(existingEnvelope)) {
          if (!sessionKeyCanRead(session, existingEnvelope)) {
            // Someone wrote this file with a different passphrase, or an older
            // build. Overwriting it would destroy work we cannot even read, so
            // stop and make the mismatch visible instead.
            setNotesScope("save");
            setNotesError(
              `${notesHandle.name} was last written with a different passphrase. Load it under that passphrase before saving, or link a different file — saving now would overwrite work this session cannot read.`
            );
            return;
          }
          try {
            const existing = await decryptJsonWithSessionKey<AnnotationsFile>(
              session,
              existingEnvelope
            );
            if (isAnnotationsFile(existing)) {
              const existingRevision = existing.revision ?? 0;
              if (existingRevision > baseRevision) {
                const merged = mergeAnnotations(mine, existing.annotations);
                mine = merged.annotations;
                mergedInFirst = merged.taken + merged.added;
                baseRevision = existingRevision;
              }
            }
          } catch {
            setNotesScope("save");
            setNotesError(
              `${notesHandle.name} could not be read back before saving, so it has been left untouched.`
            );
            return;
          }
        }
      }

      const revision = baseRevision + 1;
      const file: AnnotationsFile = { ...buildNotesFile(revision), annotations: mine };
      const envelope = await encryptJsonWithSessionKey(session, file);
      const payload = JSON.stringify(envelope, null, 2);
      const who = authorLabel.trim() ? `-${authorLabel.trim().replace(/[^A-Za-z0-9]+/g, "")}` : "";
      // Revision and author in the filename so that, in a folder listing, the
      // newest file is obvious without opening any of them.
      const filename = `slatebuilder-notes-r${String(revision).padStart(3, "0")}-${toLocalDateOnly(new Date())}${who}.sbnotes`;

      let wroteTo = filename;
      if (notesHandle && (await ensureHandlePermission(notesHandle, "readwrite"))) {
        await writeNotesHandle(notesHandle, payload);
        wroteTo = notesHandle.name;
      } else {
        downloadTextFile(filename, payload, "application/json");
      }

      rememberRevision(revision);
      rememberSeenAt(file.updatedAt);
      setLoadedNotes({
        revision,
        savedBy: file.savedBy,
        updatedAt: file.updatedAt,
        fingerprint: file.waitlist?.fingerprint,
        patientCount: file.waitlist?.patientCount,
      });
      // Everything on screen is now in the file, so nothing is outstanding.
      setSavedSignature(annotationsSignature);
      setNotesSavedAt(file.updatedAt);

      const n = Object.keys(file.annotations).length;
      const mergedNote =
        mergedInFirst > 0
          ? ` Someone had saved to this file since you opened it, so ${mergedInFirst} of their changes ${mergedInFirst === 1 ? "was" : "were"} merged in rather than overwritten.`
          : "";
      const keepNote = notesHandle
        ? ""
        : " Keep the file and its passphrase somewhere safe: it cannot be opened without the passphrase, and there is no way to reset it.";

      // A merge is news whoever asked for the save: it means a colleague's
      // work was nearly lost. Everything else about an autosave is noise.
      if (!silent || mergedInFirst > 0) {
        setNotesScope("save");
        setNotesStatus(
          `Saved revision ${revision} to ${wroteTo} — notes for ${n} patient${n === 1 ? "" : "s"}.${mergedNote}${keepNote}`
        );
      }
    } catch {
      if (!silent) setNotesError("Could not save the notes file.");
    } finally {
      savingRef.current = false;
      setNotesBusy(false);
    }
  };

  const handleSaveNotes = () => void saveNotes();

  // Autosave, for a linked file only. With one file to replace there is
  // nothing to accumulate and the read-before-write above still protects a
  // colleague; in download mode the same behaviour would rain a new file into
  // Downloads every few seconds, so it stays manual there.
  useEffect(() => {
    if (!notesHandle || !sessionKey || !notesDirty) return;
    const timer = window.setTimeout(() => void saveNotes({ silent: true }), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // annotationsSignature is what restarts the timer as editing continues, so
    // a burst of edits writes once at the end rather than once per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesHandle, sessionKey, notesDirty, annotationsSignature]);

  const handleLoadNotes = async () => {
    setNotesError(null);
    setNotesStatus(null);
    setNotesScope("load");
    if (!notesFile && !notesHandle) {
      setNotesError("Choose a saved notes file first.");
      return;
    }
    if (!notesPassphrase) {
      setNotesError("Enter the passphrase for this notes file.");
      return;
    }
    setNotesBusy(true);
    try {
      // Prefer an explicitly chosen file; otherwise read the bound one.
      let text: string;
      if (notesFile) {
        text = await notesFile.text();
      } else if (notesHandle && (await ensureHandlePermission(notesHandle, "read"))) {
        text = await readNotesHandle(notesHandle);
      } else {
        setNotesError("Could not read the notes file on this computer.");
        return;
      }
      const envelope = JSON.parse(text);
      if (!isEncryptedEnvelope(envelope)) {
        setNotesError("That file is not a SlateBuilder notes file.");
        return;
      }
      // Unlocking the file is also what establishes the key for the rest of
      // the session, so the passphrase is never asked for again.
      let session: SessionKey;
      try {
        session = await openSessionKey(notesPassphrase, envelope);
      } catch {
        setNotesError("That passphrase does not open this file.");
        return;
      }
      const decoded = await decryptJsonWithSessionKey<AnnotationsFile>(session, envelope);
      if (!isAnnotationsFile(decoded)) {
        setNotesError("That file is not a SlateBuilder notes file.");
        return;
      }

      const incomingRevision = decoded.revision ?? 0;
      const concerns = describeNotesConcerns(decoded);
      if (
        concerns.length > 0 &&
        !window.confirm(`${concerns.join("\n\n")}\n\nLoad this file anyway?`)
      ) {
        return;
      }

      if (decoded.settings) {
        setDefaultDurations(decoded.settings.defaultDurations);
        setPriorityMode(decoded.settings.priorityMode);
        setSlateCount(decoded.settings.slateCount || 2);
      }

      setSessionKey(session);
      setNotesPassphrase("");

      // Combine rather than replace, so loading a colleague's file adds their
      // work to yours instead of discarding whoever saved first.
      const mine = currentAnnotations;
      const merged = mergeAnnotations(mine, decoded.annotations);
      setNotesSavedAt(decoded.updatedAt ?? null);

      setLoadedNotes({
        revision: Math.max(incomingRevision, loadedNotes?.revision ?? 0),
        savedBy: decoded.savedBy,
        updatedAt: decoded.updatedAt,
        fingerprint: decoded.waitlist?.fingerprint,
        patientCount: decoded.waitlist?.patientCount,
      });
      rememberRevision(incomingRevision);

      if (cases.length === 0) {
        // No waitlist open yet: hold the merged notes until one is uploaded.
        pendingAnnotationsRef.current = merged.annotations;
        const n = Object.keys(merged.annotations).length;
        setNotesStatus(
          `Notes for ${n} patient${n === 1 ? "" : "s"} are ready (revision ${incomingRevision}${decoded.savedBy ? `, saved by ${decoded.savedBy}` : ""}). Upload this week's waitlist and they will be applied to everyone still on it.`
        );
      } else {
        const applied = applyAnnotations(cases, merged.annotations);
        setDurationOverrides(applied.durationOverrides);
        setUnavailableOverrides(applied.unavailableOverrides);
        setFlagOverrides(applied.flagOverrides);
        setRemovedFromSlateSuggestions(applied.removedFromSlateSuggestions);
        setRemovedFromWaitlist(applied.removedFromWaitlist);
        setAnnotationTimes(applied.times);
        // What the screen will hold once those settle. If the merge kept
        // anything of ours the file is now behind it and wants writing back;
        // otherwise the two agree and nothing is outstanding.
        setSavedSignature(
          merged.kept > 0
            ? null
            : signatureOf(
                collectAnnotations(
                  cases,
                  {
                    durationOverrides: applied.durationOverrides,
                    unavailableOverrides: applied.unavailableOverrides,
                    flagOverrides: applied.flagOverrides,
                    removedFromSlateSuggestions: applied.removedFromSlateSuggestions,
                    removedFromWaitlist: applied.removedFromWaitlist,
                  },
                  applied.times
                )
              )
        );
        setMovedCaseIds({});
        setOrderedSlates([]);
        setOrderedSlateCaseIds([]);
        setOptimizeReport(null);
        compositionSeedRef.current = "";
        const parts = [
          `${applied.matched} patient${applied.matched === 1 ? "" : "s"} on this week's list now carry notes`,
        ];
        if (merged.taken > 0) parts.push(`${merged.taken} updated from this file`);
        if (merged.kept > 0) parts.push(`${merged.kept} kept because yours were newer`);
        if (merged.added > 0) parts.push(`${merged.added} added`);
        setNotesStatus(`${parts.join(" · ")}.`);
      }
      setNotesPassphrase("");
      setNotesPassphraseConfirm("");
    } catch {
      setNotesError("Could not open that file — check the passphrase and try again.");
    } finally {
      setNotesBusy(false);
    }
  };


  const updateSlateDate = (index: number, value: string) => {
    setSlateDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Clears every piece of state keyed by caseId. Used by the workspace reset
  // paths; re-uploads instead migrate these edits onto the new file's caseIds
  // by patient identity (see pendingOverrideMigrationRef in the parse effect).
  const clearCaseKeyedState = () => {
    setAnnotationTimes({});
    setDurationOverrides({});
    setUnavailableOverrides({});
    setFlagOverrides({});
    setRemovedFromSlateSuggestions({});
    setRemovedFromWaitlist({});
    setMovedCaseIds({});
    setOrderedSlates([]);
    setOrderedSlateCaseIds([]);
    setOptimizeReport(null);
    setDragState(null);
    setDragOverTarget(null);
    setDraggingCaseId(null);
    compositionSeedRef.current = "";
  };

  // Clears every trace of the current workspace from memory and sessionStorage.
  // Shared by the Setup-tab "Reset" button and the always-visible full reset
  // below — neither leaves unencrypted PHI sitting around after the click.
  const clearWorkspaceState = () => {
    setCsvText("");
    setCases([]);
    setWarnings([]);
    setImportChecks([]);
    setImportChecksRead(false);
    setImportSummary(null);
    setUploadSummary(null);
    clearCaseKeyedState();
    setPriorityMode("urgency_then_ttt");
    setSlateCount(2);
    setSlateDates(() => {
      const today = new Date();
      return [21, 35, 49].map((offset) => {
        const next = new Date(today);
        next.setDate(today.getDate() + offset);
        return toLocalDateOnly(next);
      });
    });
    setLockedSlates({});
    setCollapsedSlates({});
    setNotesStatus(null);
    setNotesError(null);
    setNotesScope(null);
    setLoadedNotes(null);
    setNotesFile(null);
    setNotesPassphrase("");
    setNotesPassphraseConfirm("");
    // Walking away from the computer must end the session in every sense: the
    // key goes with the notes it unlocked.
    setSessionKey(null);
    setSavedSignature(null);
    setNotesSavedAt(null);
    pendingAnnotationsRef.current = null;
  };

  const resetWorkspace = () => {
    if (
      (csvText || cases.length > 0) &&
      !window.confirm("Clear the current workspace? Unsaved changes in this tab will be lost.")
    ) {
      return;
    }
    clearWorkspaceState();
  };

  // Always-visible "walk away from this computer" control. Everything about the
  // uploaded waitlist lives in this tab's memory, so clearing it really does
  // remove it — there is no copy in browser storage and none on a server. A
  // saved notes file, if one was made, is a separate file and is not touched.
  const handleFullReset = () => {
    const hasAnything = Boolean(csvText || cases.length > 0);
    if (
      hasAnything &&
      !window.confirm(
        "Clear SlateBuilder? This removes the uploaded waitlist and all notes from this screen. Any notes file you saved is kept."
      )
    ) {
      return;
    }
    clearWorkspaceState();
  };


  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadSummary(null);
    justUploadedRef.current = true;

    // Snapshot the notes currently on screen so the parse effect can carry them
    // over to matching patients in the new file. Nothing is cleared here: if the
    // file turns out to be unreadable the existing screen stays intact, and on a
    // successful parse the effect replaces every per-case map wholesale, so
    // notes attached to a row position can never leak through.
    //
    // Notes loaded from a saved file but not yet applied (because no waitlist
    // was open) take precedence — they are what the user just asked for.
    pendingAnnotationsRef.current =
      pendingAnnotationsRef.current ??
      collectAnnotations(cases, {
        durationOverrides,
        unavailableOverrides,
        flagOverrides,
        removedFromSlateSuggestions,
        removedFromWaitlist,
      });

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
        setUploadNonce((n) => n + 1);
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
      setUploadNonce((n) => n + 1);
    };
    reader.readAsText(file);
  };

  const handleDragStart = (slateIndex: number, caseId: string) => {
    setDragState({ kind: "slate", slateIndex, caseId });
    setDraggingCaseId(caseId);
  };

  const handleWaitlistDragStart = (caseId: string) => {
    setDragState({ kind: "waitlist", caseId });
    setDraggingCaseId(caseId);
  };

  // Fires once the drag gesture ends, whether or not it landed on a valid
  // drop zone — clears all transient drag-feedback state so nothing sticks.
  const handleDragEnd = () => {
    setDragState(null);
    setDraggingCaseId(null);
    setDragOverTarget(null);
  };

  // Live same-slate reordering as the dragged row passes over a sibling.
  const handleDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    slateIndex: number,
    caseId: string
  ) => {
    event.preventDefault();
    const current = dragState;
    if (
      !current ||
      current.kind !== "slate" ||
      current.caseId === caseId ||
      current.slateIndex !== slateIndex
    ) {
      return;
    }
    setOrderedSlates((prev) => {
      const next = prev.map((slate) => [...slate]);
      const slate = next[slateIndex];
      if (!slate) return prev;
      const fromIndex = slate.findIndex((item) => item.caseId === current.caseId);
      const toIndex = slate.findIndex((item) => item.caseId === caseId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = slate.splice(fromIndex, 1);
      slate.splice(toIndex, 0, moved);
      setOrderedSlateCaseIds(next.map((ordered) => ordered.map((item) => item.caseId)));
      setMovedCaseIds((prevMoved) =>
        prevMoved[current.caseId] ? prevMoved : { ...prevMoved, [current.caseId]: true }
      );
      return next;
    });
  };

  // Dropping onto a slate (from the waitlist, or from a different slate)
  // either reorders in place (handled live above) or moves the case in,
  // subject to the lock, availability, and capacity of the target slate.
  const handleDropOnSlate = (event: React.DragEvent<HTMLDivElement>, targetSlateIndex: number) => {
    event.preventDefault();
    const current = dragState;
    setDragState(null);
    setDragOverTarget(null);
    if (!current) return;
    if (current.kind === "slate" && current.slateIndex === targetSlateIndex) return; // reorder already applied

    const targetDateISO = slateSlots[targetSlateIndex]?.dateISO ?? "";
    if (lockedSlates[targetDateISO]) {
      window.alert("This slate is locked; patients cannot be added to it.");
      return;
    }
    if (current.kind === "slate" && lockedSlates[slateSlots[current.slateIndex]?.dateISO ?? ""]) {
      window.alert("That patient's slate is locked; patients cannot be removed from it.");
      return;
    }

    const source = officeCasesWithOverrides.find((c) => c.caseId === current.caseId);
    if (!source) return;
    const blockMinutes = slateSlots[targetSlateIndex]?.blockMinutes ?? 0;
    if (
      targetDateISO &&
      !isAvailableOnDate(source.unavailableUntil, new Date(`${targetDateISO}T00:00:00`))
    ) {
      window.alert("This patient is marked unavailable on that slate's date.");
      return;
    }
    const scored = scoreCases([source])[0];

    setOrderedSlates((prev) => {
      const withoutCase = prev.map((slate) => slate.filter((c) => c.caseId !== current.caseId));
      const target = withoutCase[targetSlateIndex] ?? [];
      const surgical = target.reduce((sum, c) => sum + c.estimatedDurationMin, 0);
      if (!caseFitsInSlate(surgical, target.length, scored.estimatedDurationMin, blockMinutes)) {
        window.alert("Not enough room in that slate for this patient.");
        return prev;
      }
      const next = [...withoutCase];
      next[targetSlateIndex] = sortSlateByPriority([...target, scored]);
      setOrderedSlateCaseIds(next.map((slate) => slate.map((c) => c.caseId)));
      return next;
    });
    setMovedCaseIds((prev) => (prev[current.caseId] ? prev : { ...prev, [current.caseId]: true }));
    touchAnnotations(current.caseId);
    setRemovedFromSlateSuggestions((prev) => {
      if (!prev[current.caseId]) return prev;
      const next = { ...prev };
      delete next[current.caseId];
      return next;
    });
  };

  // Dropping onto the waitlist removes the case from whichever slate it came
  // from (a no-op if it was already just a waitlist case being repositioned).
  const handleDropOnWaitlist = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const current = dragState;
    setDragState(null);
    setDragOverTarget(null);
    if (!current || current.kind === "waitlist") return;
    const sourceDateISO = activeSlateDates[current.slateIndex] ?? "";
    if (lockedSlates[sourceDateISO]) {
      window.alert("This slate is locked; patients cannot be removed from it.");
      return;
    }
    spliceCaseOutOfSlates(current.caseId);
    setRemovedFromSlateSuggestions((prev) => ({ ...prev, [current.caseId]: true }));
    touchAnnotations(current.caseId);
    backfillSlate(current.slateIndex, current.caseId);
  };

  // Case lengths are a note like any other, so this takes only a caseId: it
  // works from the waitlist, the embedded panel, or a slate, and finds the
  // slate copy itself if the patient happens to be on one. It used to require
  // the caller to know the slate index, which is why the control existed only
  // on slate cards -- the one annotation that could not be edited from the
  // list where staff actually review patients.
  const updateDuration = (caseId: string, value: string) => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    setDurationOverrides((prev) => ({ ...prev, [caseId]: minutes }));
    touchAnnotations(caseId);
    patchCaseInSlates(caseId, (item) => ({ ...item, estimatedDurationMin: minutes }));
  };

  // Patches a case's live copy inside whichever slate currently holds it (a
  // no-op if it isn't slated). Needed because slate composition is no longer
  // silently recomputed from officeCasesWithOverrides on every override edit.
  const patchCaseInSlates = (caseId: string, updater: (item: ScoredCase) => ScoredCase) => {
    setOrderedSlates((prev) => {
      let changed = false;
      const next = prev.map((slate) =>
        slate.map((item) => {
          if (item.caseId !== caseId) return item;
          changed = true;
          return updater(item);
        })
      );
      return changed ? next : prev;
    });
  };

  const findSlateIndexForCase = (caseId: string): number =>
    orderedSlates.findIndex((slate) => slate.some((item) => item.caseId === caseId));

  const updateFlag = (caseId: string, flag: ClinicalFlagKey, value: boolean) => {
    setFlagOverrides((prev) => ({
      ...prev,
      [caseId]: {
        ...prev[caseId],
        [flag]: value,
      },
    }));
    touchAnnotations(caseId);
    patchCaseInSlates(caseId, (item) => ({ ...item, flags: { ...item.flags, [flag]: value } }));
  };

  // Searches slate slots in date order for the first unlocked one the
  // candidate is available for and fits in (locked slots are skipped, with a
  // one-time alert). Shared by updateUnavailableUntil and
  // restoreToSuggestedSlates. Pass excludeCaseId when the candidate might
  // still appear in a stale copy of its old slot -- e.g. right after
  // spliceCaseOutOfSlates, whose state update hasn't committed yet, so
  // orderedSlates (read via closure) can still contain it. Returns -1 if
  // nothing fits anywhere.
  const findNextAvailableSlotIndex = (
    candidate: { estimatedDurationMin: number; unavailableUntil?: string },
    excludeCaseId?: string
  ): number => {
    let alerted = false;
    for (let i = 0; i < activeSlateDates.length; i += 1) {
      const dateISO = activeSlateDates[i];
      const date = new Date(`${dateISO}T00:00:00`);
      if (!isAvailableOnDate(candidate.unavailableUntil, date)) continue;
      const blockMinutes = getBlockMinutes(date);
      const current = (orderedSlates[i] ?? []).filter((item) => item.caseId !== excludeCaseId);
      const surgical = current.reduce((sum, item) => sum + item.estimatedDurationMin, 0);
      if (!caseFitsInSlate(surgical, current.length, candidate.estimatedDurationMin, blockMinutes)) {
        continue;
      }
      if (lockedSlates[dateISO]) {
        if (!alerted) {
          alerted = true;
          window.alert(
            `Slate ${i + 1} (${dateISO}) is locked. Placing this patient in the next available slot instead.`
          );
        }
        continue;
      }
      return i;
    }
    return -1;
  };

  const placeCandidateInSlot = (slateIndex: number, candidate: ScoredCase) => {
    setOrderedSlates((prev) => {
      const next = [...prev];
      while (next.length <= slateIndex) next.push([]);
      next[slateIndex] = sortSlateByPriority([...next[slateIndex], candidate]);
      setOrderedSlateCaseIds(next.map((slate) => slate.map((item) => item.caseId)));
      return next;
    });
  };

  // Setting (or clearing) an unavailable-until date can invalidate a slate the
  // patient is already sitting on. If so, pull them off it and look for the
  // first later, unlocked slate with room (same search order as
  // restoreToSuggestedSlates); if nothing fits, they fall back to the
  // waitlist as not-yet-slated rather than staying on a slate they can't
  // attend.
  const updateUnavailableUntil = (caseId: string, value: string) => {
    const normalized = normalizeDateOnly(value);
    setUnavailableOverrides((prev) => ({
      ...prev,
      [caseId]: value,
    }));
    touchAnnotations(caseId);

    const slateIndex = findSlateIndexForCase(caseId);
    const currentDateISO = slateIndex !== -1 ? activeSlateDates[slateIndex] ?? "" : "";
    const stillFits =
      !currentDateISO || isAvailableOnDate(normalized, new Date(`${currentDateISO}T00:00:00`));

    if (slateIndex === -1 || stillFits) {
      patchCaseInSlates(caseId, (item) => ({ ...item, unavailableUntil: normalized }));
      return;
    }

    const source = officeCasesWithOverrides.find((c) => c.caseId === caseId);
    if (!source) return;

    if (lockedSlates[currentDateISO]) {
      window.alert(
        `${source.displayLabel} is on a locked slate (${currentDateISO}) that falls before the new unavailable-until date. Unlock the slate to move them.`
      );
      patchCaseInSlates(caseId, (item) => ({ ...item, unavailableUntil: normalized }));
      return;
    }

    spliceCaseOutOfSlates(caseId);
    backfillSlate(slateIndex, caseId);
    const candidate = scoreCases([{ ...source, unavailableUntil: normalized }])[0];

    const targetIndex = findNextAvailableSlotIndex(candidate, caseId);
    if (targetIndex === -1) {
      window.alert(
        `${source.displayLabel} was taken off the ${currentDateISO} slate (now before their unavailable-until date). No later slate had room, so they're back on the waitlist as not-yet-slated.`
      );
      return;
    }
    placeCandidateInSlot(targetIndex, candidate);
    window.alert(
      `${source.displayLabel} was moved off the ${currentDateISO} slate (now before their unavailable-until date) and placed on ${activeSlateDates[targetIndex]}.`
    );
  };

  const clearUnavailableUntil = (caseId: string) => updateUnavailableUntil(caseId, "");

  // Splices a case out of whichever slate holds it (used by the button, drag
  // handlers, and the waitlist "remove" action alike).
  const spliceCaseOutOfSlates = (caseId: string) => {
    setOrderedSlates((prev) => {
      const next = prev.map((slate) => slate.filter((item) => item.caseId !== caseId));
      setOrderedSlateCaseIds(next.map((slate) => slate.map((item) => item.caseId)));
      return next;
    });
  };

  // Whenever a case leaves a slate without a specific replacement in mind
  // (removed, dragged to the waitlist, or bumped by a new unavailable-until
  // date), pull the next-highest-priority still-waiting, available patients
  // into the capacity that just opened up — greedily, in priority order —
  // so a slate never sits under-filled just because one patient left it.
  // Deliberately scoped to this one slate: it doesn't touch other slates'
  // existing occupants or reshuffle anything (that broader sweep is what the
  // explicit "Optimize Utilization" action is for). Call this AFTER the case
  // has already been removed from orderedSlates (e.g. via spliceCaseOutOfSlates).
  // `excludeCaseId` is the case that just vacated this slate, if any. It must
  // be excluded explicitly rather than via removedFromSlateSuggestions /
  // removedFromWaitlist: those flags are set via setState just before this
  // runs, and this function closes over the pre-update value of that state
  // (React doesn't rebind closures mid-event-handler) — so without this,
  // the very case that was just removed could immediately backfill its own
  // vacated spot, since it's still the highest-priority "candidate" around.
  const backfillSlate = (slateIndex: number, excludeCaseId?: string) => {
    const rawDate = activeSlateDates[slateIndex];
    if (!rawDate) return;
    const dateISO = normalizeDateOnly(rawDate) ?? rawDate;
    if (lockedSlates[dateISO]) return;
    const date = new Date(`${rawDate}T00:00:00`);
    const blockMinutes = getBlockMinutes(date);

    setOrderedSlates((prev) => {
      const current = prev[slateIndex] ?? [];
      if (current.length >= MAX_CASES_PER_SLATE) return prev;

      const placedIds = new Set(prev.flatMap((slate) => slate.map((item) => item.caseId)));
      const candidates = sortWaitlistByPriority(
        officeCasesWithOverrides.filter(
          (item) =>
            item.caseId !== excludeCaseId &&
            !placedIds.has(item.caseId) &&
            !removedFromSlateSuggestions[item.caseId] &&
            !removedFromWaitlist[item.caseId] &&
            isAvailableOnDate(item.unavailableUntil, date)
        )
      );

      let surgical = current.reduce((sum, item) => sum + item.estimatedDurationMin, 0);
      let count = current.length;
      const additions: ScoredCase[] = [];
      for (const candidate of candidates) {
        if (count >= MAX_CASES_PER_SLATE) break;
        if (!caseFitsInSlate(surgical, count, candidate.estimatedDurationMin, blockMinutes)) {
          continue;
        }
        additions.push(scoreCases([candidate])[0]);
        surgical += candidate.estimatedDurationMin;
        count += 1;
      }
      if (additions.length === 0) return prev;

      const next = [...prev];
      next[slateIndex] = sortSlateByPriority([...current, ...additions]);
      setOrderedSlateCaseIds(next.map((slate) => slate.map((item) => item.caseId)));
      return next;
    });
  };

  const removeFromSuggestedSlates = (caseId: string) => {
    const slateIndex = findSlateIndexForCase(caseId);
    if (slateIndex !== -1) {
      const dateISO = activeSlateDates[slateIndex] ?? "";
      if (lockedSlates[dateISO]) {
        window.alert("This slate is locked. Unlock it to remove this patient.");
        return;
      }
    }
    setRemovedFromSlateSuggestions((prev) => ({
      ...prev,
      [caseId]: true,
    }));
    touchAnnotations(caseId);
    spliceCaseOutOfSlates(caseId);
    if (slateIndex !== -1) backfillSlate(slateIndex, caseId);
  };

  // Restoring a removed case re-slates it where its priority naturally places
  // it: the first slot (in date order) it fits and is available for. If that
  // natural slot is locked, the user is alerted and the case goes into the
  // next available (unlocked) slot with room instead. If nothing fits, the
  // case simply returns to the waitlist as "not yet slated".
  const restoreToSuggestedSlates = (caseId: string) => {
    setRemovedFromSlateSuggestions((prev) => {
      const next = { ...prev };
      delete next[caseId];
      return next;
    });
    touchAnnotations(caseId);

    const source = officeCasesWithOverrides.find((c) => c.caseId === caseId);
    if (!source) return;
    const candidate = scoreCases([source])[0];

    const targetIndex = findNextAvailableSlotIndex(candidate);
    if (targetIndex === -1) return; // leave it on the waitlist as not-yet-slated
    placeCandidateInSlot(targetIndex, candidate);
  };

  // Removes a patient from the waitlist entirely: confirm, take them off any
  // slate, grey them out (handled in rendering via removedFromWaitlist), and
  // open a pre-filled email to booking requesting the removal.
  const removeFromWaitlist = (caseId: string) => {
    const item = officeCasesWithOverrides.find((c) => c.caseId === caseId);
    if (!item) return;
    if (
      !window.confirm(
        `Remove ${item.displayLabel} from the waitlist entirely? They will be taken off any slate.`
      )
    ) {
      return;
    }
    const slateIndex = findSlateIndexForCase(caseId);
    setRemovedFromWaitlist((prev) => ({ ...prev, [caseId]: true }));
    touchAnnotations(caseId);
    spliceCaseOutOfSlates(caseId);
    if (slateIndex !== -1) backfillSlate(slateIndex, caseId);
    const phn = item.patientRef?.trim();
    const body = [
      "Please remove the following patient from the waitlist.",
      "",
      `PHN: ${phn || "(PHN not available)"}`,
    ].join("\n");
    const mailto = `mailto:BCWHSSBooking@phsa.ca?subject=${encodeURIComponent(
      "Please remove from waitlist"
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  };

  // Reverses removeFromWaitlist: the patient reappears as "not yet slated" in
  // the active waitlist and stats. Deliberately does not re-slate them —
  // that's a separate, explicit action (drag onto a slate, or "Restore to
  // suggested slates" once they're eligible again).
  const restoreToWaitlist = (caseId: string) => {
    setRemovedFromWaitlist((prev) => {
      const next = { ...prev };
      delete next[caseId];
      return next;
    });
    touchAnnotations(caseId);
  };

  const resetDurationOverrides = () => {
    setDurationOverrides({});
    setOrderedSlates((prev) =>
      prev.map((slate) =>
        slate.map((item) => {
          const name = (item.procedureName ?? "").toLowerCase();
          let duration = defaultDurations.other;
          if (name.includes("hysterectomy")) duration = defaultDurations.hysterectomy;
          else if (name.includes("hysteroscop")) duration = defaultDurations.hysteroscopy;
          else if (name.includes("laparoscop")) duration = defaultDurations.laparoscopy;
          return { ...item, estimatedDurationMin: duration };
        })
      )
    );
  };

  const saveDefaultDurations = () => {
    window.localStorage.setItem(
      "slatebuilder-office-default-durations",
      JSON.stringify(defaultDurations)
    );
    setDefaultsSavedAt(new Date().toLocaleTimeString());
  };

  // Rearranges every unlocked slate to pack in as much OR time as possible.
  // Over-target ("anchored") cases are placed first, most urgent first, into
  // whichever unlocked slate fits them tightest -- mirroring the anchored-
  // hybrid guarantee the rest of the app makes (Long-waiters: "guaranteed
  // onto slates before any not-yet-overdue case"). Only once every anchored
  // case that can fit somewhere has been placed does the remaining room get
  // filled with not-yet-overdue cases via first-fit-decreasing bin packing.
  // This still reorders which slate an anchored case lands on and can bump
  // not-yet-overdue cases entirely, but it will never bump an overdue case
  // in favor of one that isn't. Locked slates are left untouched and
  // excluded from the pool of movable cases. Confirms first, then reports
  // what changed (including any overdue case that still couldn't be fit
  // anywhere, which is called out separately rather than left for staff to
  // notice on their own).
  const runOptimizeUtilization = () => {
    if (slateSlots.length === 0) return;
    const confirmed = window.confirm(
      "Optimize Utilization will rearrange patients across unlocked slates to pack in as much OR " +
        "time as possible. Overdue patients are placed first and are never bumped in favor of a " +
        "not-yet-overdue one, though which slate they land on may change. Locked slates are left " +
        "untouched. Continue?"
    );
    if (!confirmed) return;

    const unlockedIndices = slateSlots
      .map((_, i) => i)
      .filter((i) => !lockedSlates[slateSlots[i].dateISO]);
    if (unlockedIndices.length === 0) {
      window.alert("All slates are locked; there is nothing to optimize.");
      return;
    }

    const lockedCaseIds = new Set<string>();
    slateSlots.forEach((slot, i) => {
      if (lockedSlates[slot.dateISO]) {
        (orderedSlates[i] ?? []).forEach((c) => lockedCaseIds.add(c.caseId));
      }
    });

    const poolIds = new Set<string>();
    unlockedIndices.forEach((i) => (orderedSlates[i] ?? []).forEach((c) => poolIds.add(c.caseId)));
    slateEligibleCases.forEach((c) => {
      if (!lockedCaseIds.has(c.caseId)) poolIds.add(c.caseId);
    });
    const pool = scoreCases(
      officeCasesWithOverrides.filter((c) => poolIds.has(c.caseId) && !lockedCaseIds.has(c.caseId))
    );

    const beforeBySlate = new Map<number, { pct: number; caseIds: Set<string> }>();
    unlockedIndices.forEach((i) => {
      const blockMinutes = slateSlots[i].blockMinutes;
      const current = orderedSlates[i] ?? [];
      const surgical = current.reduce((sum, c) => sum + c.estimatedDurationMin, 0);
      const occupied = surgical + TURNAROUND_MINUTES * Math.max(0, current.length - 1);
      beforeBySlate.set(i, {
        pct: blockMinutes > 0 ? (occupied / blockMinutes) * 100 : 0,
        caseIds: new Set(current.map((c) => c.caseId)),
      });
    });

    type Bin = {
      index: number;
      dateISO: string;
      date: Date;
      blockMinutes: number;
      cases: ScoredCase[];
      surgicalMinutes: number;
    };
    const bins: Bin[] = unlockedIndices.map((i) => ({
      index: i,
      dateISO: slateSlots[i].dateISO,
      date: new Date(`${slateSlots[i].dateISO}T00:00:00`),
      blockMinutes: slateSlots[i].blockMinutes,
      cases: [],
      surgicalMinutes: 0,
    }));

    // Places one case into whichever eligible bin leaves the least room
    // (tightest fit), maximizing total time packed. Returns whether it found
    // a home.
    const placeInTightestBin = (item: ScoredCase): boolean => {
      let best: Bin | null = null;
      let bestRemaining = Infinity;
      for (const bin of bins) {
        if (bin.dateISO && !isAvailableOnDate(item.unavailableUntil, bin.date)) continue;
        if (!caseFitsInSlate(bin.surgicalMinutes, bin.cases.length, item.estimatedDurationMin, bin.blockMinutes)) {
          continue;
        }
        const occupied =
          bin.surgicalMinutes + item.estimatedDurationMin + TURNAROUND_MINUTES * bin.cases.length;
        const remaining = bin.blockMinutes - occupied;
        if (remaining < bestRemaining) {
          bestRemaining = remaining;
          best = bin;
        }
      }
      if (!best) return false;
      best.cases.push(item);
      best.surgicalMinutes += item.estimatedDurationMin;
      return true;
    };

    // Phase 1 — anchor every over-target case first, most urgent (highest
    // priority score) first, so a shorter/better-fitting not-yet-overdue
    // case can never take a slot from a longer-waiting one.
    const anchored = pool
      .filter((c) => c.timeToTargetDays < 0)
      .sort((a, b) => b.priorityScore - a.priorityScore);
    const unplacedOverdue: string[] = [];
    anchored.forEach((item) => {
      if (!placeInTightestBin(item)) unplacedOverdue.push(item.displayLabel);
    });

    // Phase 2 — fill remaining room with not-yet-overdue cases via
    // first-fit-decreasing (largest first), same packing heuristic as before.
    const notYetOverdue = pool.filter((c) => c.timeToTargetDays >= 0);
    const sortedRemainder = [...notYetOverdue].sort(
      (a, b) => b.estimatedDurationMin - a.estimatedDurationMin
    );
    sortedRemainder.forEach((item) => placeInTightestBin(item));

    setOrderedSlates((prev) => {
      const next = [...prev];
      bins.forEach((bin) => {
        next[bin.index] = sortSlateByPriority(bin.cases);
      });
      setOrderedSlateCaseIds(next.map((slate) => slate.map((c) => c.caseId)));
      return next;
    });

    const perSlate = bins.map((bin) => {
      const before = beforeBySlate.get(bin.index) ?? { pct: 0, caseIds: new Set<string>() };
      const afterIds = new Set(bin.cases.map((c) => c.caseId));
      const added = bin.cases
        .filter((c) => !before.caseIds.has(c.caseId))
        .map((c) => c.displayLabel);
      const removed = (orderedSlates[bin.index] ?? [])
        .filter((c) => before.caseIds.has(c.caseId) && !afterIds.has(c.caseId))
        .map((c) => c.displayLabel);
      const afterOccupied =
        bin.surgicalMinutes + TURNAROUND_MINUTES * Math.max(0, bin.cases.length - 1);
      return {
        slateIndex: bin.index,
        dateISO: bin.dateISO,
        beforePct: before.pct,
        afterPct: bin.blockMinutes > 0 ? (afterOccupied / bin.blockMinutes) * 100 : 0,
        added,
        removed,
      };
    });
    setOptimizeReport({ perSlate, unplacedOverdue });
    setMovedCaseIds({});
  };

  const downloadSlateCsv = (slateIndex: number) => {
    if (!slateSlots[slateIndex] || !orderedSlates[slateIndex]) return;
    const orderedSlate = orderedSlates[slateIndex];
    const dateISO = slateSlots[slateIndex].dateISO;
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
    if (!orderedSlate || orderedSlate.length === 0 || !slateSlots[slateIndex]) return null;
    const dateISO = slateSlots[slateIndex].dateISO;
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
    const dateISO = slateSlots[slateIndex]?.dateISO ?? "undated";
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
    { id: "slates", label: "Suggested slates", badge: slateSlots.length },
    // Overdue patients are the number that should pull the eye; fall back to
    // the plain total when nobody is past target.
    officeStats.overdue > 0
      ? { id: "waitlist", label: "Priority waitlist", badge: officeStats.overdue, danger: true }
      : { id: "waitlist", label: "Priority waitlist", badge: orderedByUrgency.length },
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

  // Shared row renderer used by both the dedicated Priority Waitlist tab and
  // the embedded panel at the bottom of Suggested Slates, so remove/restore/
  // drag/trash behavior stays identical in both places.
  const renderWaitlistRow = (item: PatientCase, rank: number) => {
    const expanded = Boolean(expandedCaseIds[item.caseId]);
    const removed = Boolean(removedFromWaitlist[item.caseId]);
    const slated = selectedCaseIds.has(item.caseId);
    return (
      <div
        key={item.caseId}
        draggable={!removed}
        onDragStart={() => handleWaitlistDragStart(item.caseId)}
        onDragEnd={handleDragEnd}
        className={`rounded-xl border border-sand-200 ${!removed ? "cursor-grab active:cursor-grabbing" : ""} ${
          draggingCaseId === item.caseId ? "opacity-40" : ""
        } ${removed ? "bg-sand-100/70 opacity-60" : "bg-white/70"}`}
      >
        <button
          type="button"
          onClick={() => toggleExpanded(item.caseId)}
          className="flex w-full items-center gap-3 px-3 py-2 text-left"
        >
          <span className="w-6 shrink-0 text-xs font-semibold text-sand-500">{rank}</span>
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate font-semibold ${
                removed ? "text-sand-500 line-through" : "text-slateBlue-900"
              }`}
            >
              {item.displayLabel}
              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-sand-400">
                {item.caseId}
              </span>
            </span>
            {item.procedureName && (
              <span className="block truncate text-xs text-sand-600">{item.procedureName}</span>
            )}
          </span>
          <UrgencyBadge benchmarkWeeks={item.benchmarkWeeks} timeToTargetDays={item.timeToTargetDays} />
          <span className="hidden shrink-0 text-xs text-sand-600 sm:inline">
            {item.estimatedDurationMin}m
          </span>
          {removed ? (
            <span className="shrink-0 rounded-full bg-sand-200 px-2 py-0.5 text-[11px] text-sand-600">
              Removed
            </span>
          ) : slated ? (
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
              Time to target {item.timeToTargetDays}d · Surgeon ID {item.surgeonId}
              {item.unavailableUntil ? ` · unavailable until ${item.unavailableUntil}` : ""}
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
                <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">Inpatient</span>
              )}
              {removedFromSlateSuggestions[item.caseId] && (
                <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">
                  Removed from suggestions
                </span>
              )}
            </div>

            {removed ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => restoreToWaitlist(item.caseId)}
                  className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                >
                  Restore to waitlist
                </button>
              </div>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap gap-3">
                  {clinicalFlagDefinitions.map((flag) => (
                    <label key={`${item.caseId}-${flag.key}`} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(item.flags?.[flag.key])}
                        onChange={(event) => updateFlag(item.caseId, flag.key, event.target.checked)}
                      />
                      {flag.label}
                    </label>
                  ))}
                  <label className="flex items-center gap-2">
                    Duration (min)
                    <input
                      type="number"
                      min={10}
                      step={5}
                      value={item.estimatedDurationMin}
                      onChange={(event) => updateDuration(item.caseId, event.target.value)}
                      className="w-20 rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    Patient unavailable until
                    <input
                      type="date"
                      value={item.unavailableUntil ?? ""}
                      onChange={(event) => updateUnavailableUntil(item.caseId, event.target.value)}
                      className="rounded-md border border-sand-200 bg-white px-2 py-1 text-xs"
                    />
                    {item.unavailableUntil && (
                      <button
                        type="button"
                        onClick={() => clearUnavailableUntil(item.caseId)}
                        className="rounded-full border border-sand-300 bg-white px-2 py-1 text-[11px] font-semibold text-sand-700"
                      >
                        Clear
                      </button>
                    )}
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {removedFromSlateSuggestions[item.caseId] ? (
                    <button
                      type="button"
                      onClick={() => restoreToSuggestedSlates(item.caseId)}
                      className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                    >
                      Restore to suggested slates
                    </button>
                  ) : slated ? (
                    <button
                      type="button"
                      onClick={() => removeFromSuggestedSlates(item.caseId)}
                      className="rounded-full border border-slateBlue-200 px-3 py-1 font-semibold text-slateBlue-700"
                    >
                      Remove from suggested slates
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeFromWaitlist(item.caseId)}
                    className="flex items-center gap-1.5 rounded-full border border-rose-300 px-3 py-1 font-semibold text-rose-700"
                  >
                    <TrashIcon />
                    Remove from waitlist
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Sub-list at the bottom of the Priority Waitlist: patients with a period
  // of unavailability, soonest-first. Purely a visibility aid — these
  // patients are still counted in the main waitlist above.
  const renderUnavailableSubList = () => (
    <div className="mt-4 border-t border-sand-200 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-sand-500">
        Patients with a period of unavailability ({unavailableOfficeCases.length})
      </p>
      {unavailableOfficeCases.length === 0 ? (
        <p className="mt-2 text-xs text-sand-500">No patients currently have an unavailable-until date.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {unavailableOfficeCases.map((item) => {
            const slated = selectedCaseIds.has(item.caseId);
            return (
              <div
                key={item.caseId}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-sand-800"
              >
                <span className="font-semibold text-slateBlue-900">{item.displayLabel}</span>
                <span className="text-[10px] uppercase tracking-wider text-sand-400">{item.caseId}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                  Unavailable until {item.unavailableUntil}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    slated ? "bg-slateBlue-100 text-slateBlue-700" : "bg-sand-100 text-sand-600"
                  }`}
                >
                  {slated ? "Slated" : "Waiting"}
                </span>
                <button
                  type="button"
                  onClick={() => clearUnavailableUntil(item.caseId)}
                  className="ml-auto rounded-full border border-sand-300 bg-white px-2 py-1 font-semibold text-sand-700"
                >
                  Clear
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12">
      <div className="sticky top-0 z-30 -mx-6 mb-2 bg-sand-50/95 px-6 pt-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-sand-700">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sand-500">
            SlateBuilder for Offices
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
            <button
              type="button"
              onClick={() => {
                setWaitlistOverdueOnly(false);
                setWaitlistUnslatedOnly(false);
                setActiveTab("waitlist");
              }}
              title="View the full Priority Waitlist"
              className="hover:underline"
            >
              Cases <span className="font-semibold text-slateBlue-900">{officeStats.totalCases}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setWaitlistOverdueOnly(true);
                setWaitlistUnslatedOnly(false);
                setActiveTab("waitlist");
              }}
              title="View overdue patients on the Priority Waitlist"
              className={`hover:underline ${officeStats.overdue > 0 ? "text-rose-600" : ""}`}
            >
              Overdue <span className="font-semibold">{officeStats.overdue}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("slates")}
              title="View the suggested slates"
              className="hover:underline"
            >
              Slated <span className="font-semibold text-slateBlue-900">{selectedCaseIds.size}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setWaitlistOverdueOnly(false);
                setWaitlistUnslatedOnly(true);
                setActiveTab("waitlist");
              }}
              title="View not-yet-slated patients on the Priority Waitlist"
              className="hover:underline"
            >
              Waiting{" "}
              <span className="font-semibold text-slateBlue-900">{remainingByUrgency.length}</span>
            </button>
            {cases.length > 0 && (
              <span
                title="This waitlist is held in this tab only. It is not saved to this computer or sent anywhere, and closing the tab clears it."
                className="inline-flex items-center gap-1.5 font-semibold text-sand-800"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                On this device only
              </span>
            )}
            <NotesSaveState
              busy={notesBusy}
              dirty={notesDirty}
              count={annotationsCount}
              linked={Boolean(notesHandle)}
              unlocked={Boolean(sessionKey)}
              savedAt={notesSavedAt}
              onSave={() => {
                // Without a key there is no passphrase yet, and asking for one
                // belongs where it is explained rather than in a toolbar.
                if (!sessionKey) {
                  setActiveTab("setup");
                  setNotesScope("save");
                  window.requestAnimationFrame(() =>
                    document.getElementById("notes-save-card")?.scrollIntoView({ block: "center" })
                  );
                  return;
                }
                void saveNotes();
              }}
            />
            <button
              type="button"
              onClick={handleFullReset}
              title="Clear the uploaded waitlist and all notes from this screen"
              className="rounded-full border border-rose-300 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
            >
              Clear screen
            </button>
          </div>
        </div>
        <div className="relative">
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
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-sand-50 to-transparent sm:hidden"
          />
        </div>
      </div>

      {importChecks.length > 0 && !importChecksRead && (
        <ImportCheckPanel checks={importChecks} onAcknowledge={() => setImportChecksRead(true)} />
      )}

      {activeTab === "setup" && (
        <>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <StepHeading step={1} title="Load this week's waitlist" />
          <p className="mt-1 text-sm text-sand-700">
            The file the hospital sent, as CSV or Excel. It is read here in your browser and is
            not uploaded anywhere.
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
                  title="Clears the uploaded waitlist and all edits on this device"
                  className="rounded-full border border-sand-300 bg-white px-4 py-2 text-xs font-semibold text-sand-800"
                >
                  Clear waitlist
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

            {uploadSummary && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold">{uploadSummary}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("slates")}
                    className="rounded-full bg-emerald-700 px-3 py-1.5 font-semibold text-white"
                  >
                    View suggested slates →
                  </button>
                </div>
                {importSummary && (
                  <p className="mt-2 border-t border-emerald-200 pt-2 text-emerald-900">
                    <span className="font-semibold">Read as:</span> {importSummary}.{" "}
                    <span className="text-emerald-800">
                      If that does not match the list you know, stop and check the file rather
                      than the slates.
                    </span>
                  </p>
                )}
              </div>
            )}

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
          <StepHeading step={2} title="Restore your notes" optional />
          <p className="mt-1 text-sm text-sand-700">
            Your notes from last week — unavailable dates, case lengths, clinical flags. They are
            matched to whoever is still on the list you just loaded.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {notesHandle ? (
              <div className="rounded-xl border border-slateBlue-200 bg-slateBlue-50/60 px-3 py-2 text-xs text-slateBlue-900">
                <span className="font-semibold">Linked to {notesHandle.name}</span> on this computer.
                Saving replaces this file rather than adding another copy.
                <button
                  type="button"
                  onClick={() => void handleUnbindNotesFile()}
                  className="ml-2 font-semibold underline"
                >
                  Unlink
                </button>
              </div>
            ) : canBindFile ? (
              <div className="rounded-xl border border-sand-200 bg-white/70 px-3 py-2 text-xs text-sand-700">
                <span className="font-semibold text-sand-900">Recommended:</span> link one notes file
                on this computer, so every save replaces it instead of leaving copies in Downloads.
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* Both ways in matter. "Use an existing file" opens a picker
                      that can only select a file that is already there, so on
                      the first day of use -- when no notes file exists yet --
                      it is the one thing that cannot work. */}
                  <button
                    type="button"
                    onClick={() => void handleChooseNotesFile("create")}
                    className="font-semibold text-slateBlue-700 underline"
                  >
                    Create a new notes file
                  </button>
                  <span className="text-sand-500">or</span>
                  <button
                    type="button"
                    onClick={() => void handleChooseNotesFile("open")}
                    className="font-semibold text-slateBlue-700 underline"
                  >
                    use one you already have
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                This browser cannot save straight to a folder, so notes are downloaded as a new file
                each time. Chrome or Edge can link one file instead. Take care to keep only the
                newest copy.
              </div>
            )}
            <label className="flex flex-col gap-1.5 text-xs text-sand-700">
              {notesHandle ? "Or choose a different file" : "Notes file"}
              <input
                type="file"
                accept=".sbnotes,application/json"
                onChange={(event) => setNotesFile(event.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-sand-700">
              Passphrase for this file
              <input
                type="password"
                value={notesPassphrase}
                onChange={(event) => setNotesPassphrase(event.target.value)}
                className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={notesBusy || (!notesFile && !notesHandle)}
              onClick={() => void handleLoadNotes()}
              className="self-start rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700 disabled:opacity-50"
            >
              {notesBusy ? "Working…" : "Load notes"}
            </button>
            {notesScope === "load" && notesStatus && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
                {notesStatus}
              </div>
            )}
            {notesScope === "load" && notesError && (
              <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
                {notesError}
              </div>
            )}
            <p className="text-xs text-sand-600">
              First time using SlateBuilder, or no notes yet? Skip this — you can save a notes file
              at the end of the session.
            </p>
          </div>
        </div>
      </section>

      <section className="card p-6">
        <StepHeading step={3} title="Check the scheduling rules" />
          <div className="mt-4 grid gap-6">
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
              <p className="mt-1 text-xs text-sand-600">
                Defaults to 3, 5, and 7 weeks from today — confirm these match your actual OR block
                dates before finalizing a slate.
              </p>
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

      <section className="card p-6" id="notes-save-card">
        <h2 className="text-lg font-semibold text-slateBlue-900">
          {sessionKey && notesHandle ? "Your notes are saving themselves" : "Before you finish: save your notes"}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-sand-700">
          {sessionKey && notesHandle
            ? `Every change you make is written to ${notesHandle.name} a couple of seconds later, without asking for the passphrase again. The header shows whether anything is still outstanding, from whichever tab you are on.`
            : "Closing the tab clears everything. Save your notes to this computer and you can restore them at step 2 next week, instead of entering them again."}
        </p>

        {loadedNotes && (
          <p className="mt-2 text-xs text-sand-600">
            Working from revision {loadedNotes.revision}
            {loadedNotes.savedBy ? `, saved by ${loadedNotes.savedBy}` : ""} on{" "}
            {loadedNotes.updatedAt.slice(0, 10)}
            {loadedNotes.patientCount !== undefined
              ? ` against a ${loadedNotes.patientCount}-patient list`
              : ""}
            . Saving will write revision {loadedNotes.revision + 1}.
          </p>
        )}

        <div className="mt-4 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-sand-200 bg-white/70 p-4">
            <p className="text-xs text-sand-600">
              {annotationsCount > 0
                ? `${annotationsCount} patient${annotationsCount === 1 ? " has" : "s have"} notes to save: unavailable dates, case lengths you have adjusted, clinical flags, and anyone you have taken off the list.`
                : "Nothing to save yet. Notes appear here once you set an unavailable date, adjust a case length, tick a clinical flag, or remove someone."}
            </p>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-xs text-sand-700">
                Who is saving (initials or role)
                <input
                  type="text"
                  value={authorLabel}
                  onChange={(event) => {
                    setAuthorLabel(event.target.value);
                    try {
                      window.localStorage.setItem(AUTHOR_LABEL_KEY, event.target.value);
                    } catch {
                      // not remembering the label is harmless
                    }
                  }}
                  placeholder="e.g. MOA"
                  className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              {/* Asked for once, when this file is first created. After that
                  the key lives in memory for the session and neither a manual
                  save nor an autosave needs it again. */}
              {!sessionKey && (
                <>
                  <label className="flex flex-col gap-1.5 text-xs text-sand-700">
                    Passphrase (at least {MIN_PASSPHRASE_LENGTH} characters)
                    <input
                      type="password"
                      value={notesPassphrase}
                      onChange={(event) => setNotesPassphrase(event.target.value)}
                      placeholder="Several words together work well"
                      className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs text-sand-700">
                    Confirm passphrase
                    <input
                      type="password"
                      value={notesPassphraseConfirm}
                      onChange={(event) => setNotesPassphraseConfirm(event.target.value)}
                      className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <p className="text-xs text-sand-600">
                    You will be asked for this once. It is needed again only when this file is
                    opened afresh — next week, or by whoever you share it with.
                  </p>
                </>
              )}
              <button
                type="button"
                disabled={notesBusy || annotationsCount === 0 || (Boolean(sessionKey) && !notesDirty)}
                onClick={() => void handleSaveNotes()}
                className="self-start rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {notesBusy
                  ? "Working…"
                  : sessionKey
                    ? notesDirty
                      ? "Save now"
                      : "Everything is saved"
                    : "Save notes file"}
              </button>
              {notesScope === "save" && notesStatus && (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
                  {notesStatus}
                </div>
              )}
              {notesScope === "save" && notesError && (
                <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
                  {notesError}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-sand-200 bg-sand-50 px-4 py-3 text-xs text-sand-700">
            <p className="font-semibold text-sand-900">What is in the notes file</p>
            <p className="mt-1">
              Only your notes, locked with your passphrase: each patient&apos;s PHN, any unavailable
              date, adjusted case length, clinical flags, and whether you removed them. It does{" "}
              <span className="font-semibold">not</span> contain patient names, diagnoses, or the
              waitlist itself — the hospital&apos;s file stays the only list.
            </p>
            <p className="mt-1">
              It is still a health record: keep it somewhere your office keeps confidential files, and
              delete it when the pilot ends. Nobody can recover it if the passphrase is lost.
            </p>
          </div>
        </div>
      </section>

      <header>
        <div className="card p-8">
          <p className="text-sm uppercase tracking-[0.26em] text-sand-600">
            Office Scheduling Toolkit
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slateBlue-900">
            How SlateBuilder for Offices works
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sand-800">
            Upload one surgeon office&apos;s waitlist, generate streamlined OR slates, and maintain
            a Priority Waitlist that clearly shows which patients are already slated and which are
            still waiting.
          </p>
          <p className="mt-3 max-w-3xl text-xs leading-6 text-sand-700">
            Higher priority scores mean more urgent — patients past their target date are always
            slated first. See the <a href="/guide" target="_blank" rel="noopener noreferrer" className="font-semibold text-slateBlue-700 underline">user guide</a> for exactly how the score is calculated.
          </p>
          <p className="mt-3 max-w-3xl text-xs leading-6 text-sand-600">
            Nothing you upload leaves this computer. There is no account and no server to sync to:
            the waitlist is read in your browser, held only while this tab is open, and never sent
            anywhere. Each case gets an opaque code (e.g. C-001) and exports use that code unless
            you opt to include names.
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
              Nothing leaves this computer
            </span>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Encrypted notes file
            </span>
            <span className="rounded-full border border-sand-300 bg-white/80 px-3 py-1.5">
              Up to 3 selectable OR dates
            </span>
          </div>
        </div>
      </header>

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
              {slates && slateSlots.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={runOptimizeUtilization}
                    className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Optimize Utilization
                  </button>
                  <button
                    type="button"
                    onClick={downloadAllSlatesPdfFile}
                    className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Export all slates (PDF)
                  </button>
                </>
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

          {slates &&
            slateSlots.length > 0 &&
            slateSlots.every((slot, i) => (orderedSlates[i] ?? slot.selected).length === 0) && (
              <div className="mt-6 rounded-2xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
                No cases fit into the selected block lengths.
              </div>
            )}

          {slates &&
            slateSlots.length > 0 &&
            slateSlots.some((slot, i) => (orderedSlates[i] ?? slot.selected).length > 0) && (
            <div className="mt-6 flex flex-col gap-6">
              {slateSlots.map((slot, slateIndex) => {
                const orderedSlate = orderedSlates[slateIndex] ?? slot.selected;
                const slateDate = slot.dateISO;
                const schedule = buildCaseSchedule(orderedSlate, slateDate);
                const surgicalMinutes = orderedSlate.reduce(
                  (sum, item) => sum + item.estimatedDurationMin,
                  0
                );
                const turnaroundMinutes =
                  TURNAROUND_MINUTES * Math.max(0, orderedSlate.length - 1);
                const occupiedMinutes = surgicalMinutes + turnaroundMinutes;
                const utilizationPct =
                  slot.blockMinutes > 0 ? (occupiedMinutes / slot.blockMinutes) * 100 : 0;
                const isLocked = Boolean(lockedSlates[slateDate]);
                const isCollapsed = Boolean(collapsedSlates[slateDate]);
                const isDragOverThisSlate =
                  dragOverTarget?.kind === "slate" && dragOverTarget.slateIndex === slateIndex;

                return (
                  <div
                    key={`slate-${slateIndex}`}
                    className="rounded-2xl border border-sand-200 bg-white/70 p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedSlates((prev) => ({ ...prev, [slateDate]: !prev[slateDate] }))
                          }
                          aria-label={isCollapsed ? "Expand slate" : "Collapse slate"}
                          className="mt-0.5 rounded-full border border-sand-300 bg-white px-2 py-1 text-xs text-sand-600"
                        >
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-sand-600">
                            Slate {slateIndex + 1}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-slateBlue-900">
                            {orderedSlate.length} cases on {slateDate || "unspecified date"}
                          </h3>
                        </div>
                        <span
                          title={`${occupiedMinutes} / ${slot.blockMinutes} min used (incl. turnaround)`}
                          className={`mt-0.5 rounded-full px-2 py-1 text-[11px] font-semibold ${
                            occupiedMinutes > slot.blockMinutes
                              ? "bg-rose-100 text-rose-700"
                              : utilizationPct >= 85
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {utilizationPct.toFixed(0)}% full
                        </span>
                        {isLocked && (
                          <span className="mt-0.5 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
                            🔒 Locked
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setLockedSlates((prev) => ({ ...prev, [slateDate]: !prev[slateDate] }))
                          }
                          className={`rounded-full border px-4 py-2 text-xs font-semibold ${
                            isLocked
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-slateBlue-200 text-slateBlue-700"
                          }`}
                        >
                          {isLocked ? "Unlock slate" : "Lock slate"}
                        </button>
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
                          title="Confidential: opaque case code → patient name, for re-identifying the deidentified slate/CSV exports"
                          className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
                        >
                          Export name key (confidential)
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                    <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <StatCard
                        label="Utilization"
                        value={`${utilizationPct.toFixed(1)}%`}
                        detail={`${occupiedMinutes} / ${slot.blockMinutes} min (incl. ${turnaroundMinutes} min TAT)`}
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
                      <CapacityBar totalMinutes={occupiedMinutes} blockMinutes={slot.blockMinutes} />
                      <p className="mt-2 text-xs text-sand-600">
                        {surgicalMinutes} min surgical + {turnaroundMinutes} min turnaround (30 min
                        after each case but the last).
                      </p>
                    </div>

                    <div
                      className={`mt-4 flex min-h-[3rem] flex-col gap-3 rounded-2xl border-2 border-dashed p-1 transition-colors ${
                        isDragOverThisSlate
                          ? "border-slateBlue-400 bg-slateBlue-50/60"
                          : "border-transparent"
                      }`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setDragOverTarget({ kind: "slate", slateIndex });
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverTarget({ kind: "slate", slateIndex });
                      }}
                      onDrop={(event) => handleDropOnSlate(event, slateIndex)}
                    >
                      {schedule.map(({ item, start, end, tatAfter, tatEnd }, index) => (
                        <Fragment key={item.caseId}>
                        <div
                          draggable
                          onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                          onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                          onDragEnd={handleDragEnd}
                          className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sand-200 bg-white px-4 py-3 text-sm shadow-sm cursor-grab active:cursor-grabbing ${
                            draggingCaseId === item.caseId ? "opacity-40" : ""
                          }`}
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
                              Time to target {item.timeToTargetDays}d · {item.estimatedDurationMin}m
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
                              {movedCaseIds[item.caseId] && (
                                <span
                                  title="Manually repositioned from the suggested order"
                                  className="rounded-full bg-amber-100 px-2 py-1 text-amber-800"
                                >
                                  ↕ Moved
                                </span>
                              )}
                              <span
                                title="Priority score: higher means more urgent. Used to rank and auto-fill the waitlist — not shown to patients."
                                className="rounded-full bg-slateBlue-50 px-2 py-1 text-slateBlue-700"
                              >
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
                                  updateDuration(item.caseId, event.target.value)
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
                              {item.unavailableUntil && (
                                <button
                                  type="button"
                                  onClick={() => clearUnavailableUntil(item.caseId)}
                                  className="rounded-full border border-sand-300 bg-white px-2 py-1 text-[11px] font-semibold text-sand-700"
                                >
                                  Clear
                                </button>
                              )}
                            </label>
                            {isLocked ? (
                              <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                                🔒 Locked — unlock slate to remove
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => removeFromSuggestedSlates(item.caseId)}
                                className="rounded-full border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-sand-800"
                              >
                                Remove from suggested slates
                              </button>
                            )}
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
                    </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {optimizeReport && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slateBlue-900">
                    Optimize Utilization — Summary
                  </h2>
                  <button
                    type="button"
                    onClick={() => setOptimizeReport(null)}
                    className="rounded-full border border-sand-300 px-3 py-1 text-xs font-semibold text-slateBlue-700"
                  >
                    Close
                  </button>
                </div>
                {optimizeReport.unplacedOverdue.length > 0 && (
                  <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
                    <p className="font-semibold">
                      {optimizeReport.unplacedOverdue.length === 1
                        ? "1 overdue patient could not be fit into any unlocked slate:"
                        : `${optimizeReport.unplacedOverdue.length} overdue patients could not be fit into any unlocked slate:`}
                    </p>
                    <p className="mt-1">{optimizeReport.unplacedOverdue.join(", ")}</p>
                    <p className="mt-1 text-xs">
                      They were not bumped by a not-yet-overdue case — there simply wasn&apos;t room
                      anywhere unlocked. They&apos;re back on the Priority Waitlist as not-yet-slated.
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-col gap-3 text-sm text-sand-800">
                  {optimizeReport.perSlate.map((s) => (
                    <div key={s.slateIndex} className="rounded-xl border border-sand-200 p-3">
                      <p className="font-semibold text-slateBlue-900">
                        Slate {s.slateIndex + 1} · {s.dateISO || "unspecified date"}
                      </p>
                      <p className="text-xs text-sand-700">
                        Utilization {s.beforePct.toFixed(1)}% → {s.afterPct.toFixed(1)}%
                      </p>
                      {s.added.length > 0 && (
                        <p className="mt-1 text-xs text-emerald-700">Added: {s.added.join(", ")}</p>
                      )}
                      {s.removed.length > 0 && (
                        <p className="mt-1 text-xs text-rose-700">Removed: {s.removed.join(", ")}</p>
                      )}
                      {s.added.length === 0 && s.removed.length === 0 && (
                        <p className="mt-1 text-xs text-sand-500">No changes.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card p-6">
          <button
            type="button"
            onClick={() => setWaitlistPanelCollapsed((v) => !v)}
            className="flex w-full items-center justify-between gap-4 text-left"
          >
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">Priority Waitlist</h2>
              <p className="text-sm text-sand-700">
                Drag patients onto a slate to add them, or off a slate to send them back here.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-sand-300 bg-white px-3 py-1 text-xs font-semibold text-slateBlue-700">
              {waitlistPanelCollapsed ? "Show ▸" : "Hide ▾"}
            </span>
          </button>

          {!waitlistPanelCollapsed && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
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
              <div
                className={`mt-2 flex min-h-[3rem] flex-col gap-1.5 rounded-2xl border-2 border-dashed p-1 text-sm transition-colors ${
                  dragOverTarget?.kind === "waitlist"
                    ? "border-slateBlue-400 bg-slateBlue-50/60"
                    : "border-transparent"
                }`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragOverTarget({ kind: "waitlist" });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverTarget({ kind: "waitlist" });
                }}
                onDrop={handleDropOnWaitlist}
              >
                {filteredWaitlist.map(({ item, rank }) => renderWaitlistRow(item, rank))}
                {filteredWaitlist.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
                    {orderedByUrgency.length === 0
                      ? "No office waitlist loaded yet."
                      : "No patients match the filter."}
                  </div>
                )}
              </div>
              {renderUnavailableSubList()}
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

          <div className="mt-4 rounded-2xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Priority rule</p>
            <p className="mt-0.5 text-xs text-sand-600">
              Controls how this list (and slate auto-fill) ranks patients.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:gap-8">
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
                  <span className="font-semibold">Urgency first, then wait time (default)</span>
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

          <div
            className={`mt-2 flex min-h-[3rem] flex-col gap-1.5 rounded-2xl border-2 border-dashed p-1 text-sm transition-colors ${
              dragOverTarget?.kind === "waitlist" ? "border-slateBlue-400 bg-slateBlue-50/60" : "border-transparent"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragOverTarget({ kind: "waitlist" });
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOverTarget({ kind: "waitlist" });
            }}
            onDrop={handleDropOnWaitlist}
          >
            {filteredWaitlist.map(({ item, rank }) => renderWaitlistRow(item, rank))}

            {filteredWaitlist.length === 0 && (
              <div className="rounded-2xl border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
                {orderedByUrgency.length === 0
                  ? "No office waitlist loaded yet."
                  : "No patients match the filter."}
              </div>
            )}
          </div>
          {renderUnavailableSubList()}
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
          &copy; 2026 Dr. Jonathan Collins. All rights reserved. SlateBuilder for Offices was
          developed by Dr. Jonathan Collins for BC Women&apos;s Hospital Surgical Services pilot
          use, with AI-assisted development tools. It is provided as a scheduling aid for pilot
          evaluation only — always verify case details, priority scores, and slate assignments
          before relying on them clinically.
        </p>
      </section>
      )}
    </main>
  );
}
