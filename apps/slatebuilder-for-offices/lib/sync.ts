import {
  ClinicalFlagKey,
  EncryptedEnvelope,
  PatientCase,
  SealedBlob,
  generateOfficeKey,
  openSealed,
  patientToken,
  sealJson,
  unwrapOfficeKey,
  wrapOfficeKey,
  bytesToBase64Url,
} from "@slatebuilder/core";

// The end-to-end-encrypted working blob. Everything is keyed by patient token
// (HMAC of the PHN) — never by name. No PHI is present.
export type SyncedState = {
  v: 1;
  patientState: Record<
    string,
    {
      unavailableUntil?: string;
      durationOverrideMin?: number;
      flagOverrides?: Partial<Record<ClinicalFlagKey, boolean>>;
      removed?: boolean;
    }
  >;
  plan: {
    status: "draft" | "finalized";
    slateDates: string[];
    assignments: Record<string, string[]>; // dateISO -> ordered patient tokens
    updatedAt: string;
  };
  settings: {
    defaultDurations: { hysteroscopy: number; laparoscopy: number; hysterectomy: number; other: number };
    priorityMode: "ttt" | "urgency_then_ttt";
    slateCount: number;
  };
};

export function emptySyncedState(): SyncedState {
  return {
    v: 1,
    patientState: {},
    plan: { status: "draft", slateDates: [], assignments: {}, updatedAt: new Date().toISOString() },
    settings: {
      defaultDurations: { hysteroscopy: 30, laparoscopy: 60, hysterectomy: 180, other: 90 },
      priorityMode: "urgency_then_ttt",
      slateCount: 2,
    },
  };
}

// ---- Auth + key handling (office key never leaves the browser) -------------

export async function signupOffice(
  officeId: string,
  password: string
): Promise<{ officeKey: Uint8Array; recoveryCode: string }> {
  const officeKey = generateOfficeKey();
  const wrappedOfficeKey = await wrapOfficeKey(password, officeKey);
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeId, password, wrappedOfficeKey }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Sign-up failed.");
  return { officeKey, recoveryCode: bytesToBase64Url(officeKey) };
}

export async function loginOffice(officeId: string, password: string): Promise<Uint8Array> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeId, password }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Sign-in failed.");
  const { wrappedOfficeKey } = (await res.json()) as { wrappedOfficeKey: EncryptedEnvelope };
  return unwrapOfficeKey(password, wrappedOfficeKey);
}

export async function logoutOffice(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

// ---- State sync -----------------------------------------------------------

export async function fetchState(
  officeKey: Uint8Array
): Promise<{ state: SyncedState; version: number }> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error("Could not load cloud state.");
  const { ciphertext, version } = (await res.json()) as {
    ciphertext: SealedBlob | null;
    version: number;
  };
  const state = ciphertext ? await openSealed<SyncedState>(officeKey, ciphertext) : emptySyncedState();
  return { state, version };
}

/** Saves the sealed state. Returns the new version, or { conflict, version } on a version clash. */
export async function putState(
  officeKey: Uint8Array,
  state: SyncedState,
  expectedVersion: number
): Promise<{ version: number } | { conflict: true; version: number }> {
  const ciphertext = await sealJson(officeKey, state);
  const res = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertext, expectedVersion }),
  });
  if (res.status === 409) {
    const { version } = await res.json();
    return { conflict: true, version };
  }
  if (!res.ok) throw new Error("Could not save to the cloud.");
  return { version: (await res.json()).version };
}

// ---- Token mapping (browser only) -----------------------------------------

/** caseId -> patient token, for every case that has a PHN. */
export async function buildCaseTokens(
  officeKey: Uint8Array,
  cases: PatientCase[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const c of cases) {
    if (c.patientRef) map[c.caseId] = await patientToken(officeKey, c.patientRef);
  }
  return map;
}
