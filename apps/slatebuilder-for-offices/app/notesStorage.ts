"use client";

// Binding the notes file to one place on this computer.
//
// Without this, "Save notes" drops a fresh copy into the Downloads folder every
// time, and an office ends up with several files whose only distinguishing
// feature is a timestamp. The File System Access API lets the browser hold a
// handle to one chosen file and overwrite it in place, so there is exactly one
// notes file, in a folder the office picked deliberately — which also keeps it
// out of a Downloads folder that may be syncing to somebody's personal cloud.
//
// The capability is detected, never inferred from the browser name. A user
// agent string is not evidence: Chrome on iOS reports "Chrome" but has no such
// API, several Chromium browsers do not say "Chrome" at all, and the API is
// absent over plain HTTP regardless of browser. Asking for the function itself
// is the only check that is right in all of those cases.

type FilePickerAcceptType = { description?: string; accept: Record<string, string[]> };

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  id?: string;
};

type OpenFilePickerOptions = {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
  id?: string;
};

type PermissionMode = { mode: "read" | "readwrite" };

// Minimal shape of the handle; the DOM lib's own definition varies by TS
// version, so the parts actually used are declared here.
export type NotesFileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(options: PermissionMode): Promise<PermissionState>;
  requestPermission?(options: PermissionMode): Promise<PermissionState>;
};

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<NotesFileHandle>;
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<NotesFileHandle[]>;
  }
}

const NOTES_FILE_TYPE: FilePickerAcceptType = {
  description: "SlateBuilder notes",
  accept: { "application/json": [".sbnotes"] },
};

/**
 * Whether this browser can write to a file the user chooses.
 *
 * Both halves matter: the API must exist, and the page must be in a secure
 * context, since browsers withhold it over plain HTTP. An office served the
 * app over an internal `http://` address will land here even on Chrome.
 */
export function canBindNotesFile(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.showSaveFilePicker === "function" && window.isSecureContext;
}

export async function pickNotesFileForSaving(
  suggestedName: string
): Promise<NotesFileHandle | null> {
  if (!window.showSaveFilePicker) return null;
  try {
    return await window.showSaveFilePicker({
      suggestedName,
      types: [NOTES_FILE_TYPE],
      id: "slatebuilder-notes",
    });
  } catch {
    // The picker throws on cancel; that is a normal outcome, not an error.
    return null;
  }
}

export async function pickNotesFileForOpening(): Promise<NotesFileHandle | null> {
  if (!window.showOpenFilePicker) return null;
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [NOTES_FILE_TYPE],
      multiple: false,
      id: "slatebuilder-notes",
    });
    return handle ?? null;
  } catch {
    return null;
  }
}

/**
 * Confirms the page may still use a handle restored from a previous session.
 * Browsers deliberately drop the grant between visits, so this may prompt.
 */
export async function ensureHandlePermission(
  handle: NotesFileHandle,
  mode: "read" | "readwrite"
): Promise<boolean> {
  try {
    if (!handle.queryPermission || !handle.requestPermission) return true;
    if ((await handle.queryPermission({ mode })) === "granted") return true;
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

export async function readNotesHandle(handle: NotesFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function writeNotesHandle(handle: NotesFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

// ---- Remembering the chosen file between sessions --------------------------
//
// File handles are structured-cloneable, so IndexedDB can hold one. What is
// stored is a reference to a location the user chose, not any file content and
// no patient information — the notes themselves stay encrypted in that file.

const DB_NAME = "slatebuilder-notes";
const STORE = "handles";
const HANDLE_KEY = "notes-file";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function rememberNotesHandle(handle: NotesFileHandle): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function recallNotesHandle(): Promise<NotesFileHandle | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<NotesFileHandle | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as NotesFileHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function forgetNotesHandle(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
