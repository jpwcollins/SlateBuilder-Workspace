// Passphrase-based encryption for work saved to the user's own device.
// Runs entirely in the browser via WebCrypto. Mirrors the "password-protected
// file" model the offices already use for the waitlist the hospital sends
// them: one passphrase to lock, the same to unlock.
//
// AES-256-GCM (authenticated) with a key derived from the passphrase via
// PBKDF2-SHA256. A random salt and IV are stored alongside the ciphertext; the
// passphrase itself is never persisted, and there is no recovery path — a
// forgotten passphrase means the file cannot be opened by anyone, including us.

export type EncryptedEnvelope = {
  v: 1;
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
};

// Iteration count for newly written files. Files record the count they were
// written with and are decrypted using *that* value (see decryptJson), so this
// can be raised over time without stranding files written under an older one.
const PBKDF2_ITERATIONS = 600_000;

// Anything below this is not a passphrase worth the name: the file's entire
// security rests on it, and an attacker who obtains the file can guess offline
// at whatever rate their hardware allows.
export const MIN_PASSPHRASE_LENGTH = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(passphrase: string, value: unknown): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  const v = value as EncryptedEnvelope;
  return (
    typeof value === "object" &&
    value !== null &&
    v.alg === "AES-GCM" &&
    typeof v.ciphertext === "string" &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    Number.isFinite(v.iterations) &&
    v.iterations > 0
  );
}

/**
 * Decrypts an envelope produced by {@link encryptJson}. Throws if the
 * passphrase is wrong or the data was tampered with (GCM authentication fails).
 *
 * The key is re-derived using the iteration count recorded *in the envelope*,
 * not the current default, so files written under an earlier count still open.
 */
export async function decryptJson<T = unknown>(
  passphrase: string,
  envelope: EncryptedEnvelope
): Promise<T> {
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt, envelope.iterations);
  const ciphertext = fromBase64(envelope.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// ---- Session keys ---------------------------------------------------------
//
// Deriving a key costs 600,000 PBKDF2 iterations -- around a second. That is
// the right price to pay once, and the wrong price to pay on every save: it is
// the reason the app used to demand the passphrase each time, which in an
// office means typing it twice for every case length you adjust.
//
// A session key is derived once, when a notes file is created or opened, and
// held in memory for as long as that file is open. Two properties make this
// safe to do:
//
//   * The key is non-extractable (see deriveKey). Once derived it cannot be
//     read back out by any script, so what is held in memory is strictly less
//     dangerous than the passphrase string it came from -- which is no longer
//     kept at all.
//
//   * The salt belongs to the file, not to the save. It is fixed when the file
//     is created and preserved by everyone who writes to it afterwards, so a
//     colleague's save can still be read back with the same session key. Only
//     the IV is fresh per save, which is what AES-GCM actually requires.
//
// Nothing here is persisted. Closing the tab ends the session and the key with
// it; reopening the file asks for the passphrase again.

export type SessionKey = {
  /** Non-extractable AES-GCM key. Cannot be serialized, and deliberately so. */
  key: CryptoKey;
  /** The file's salt, in the same base64 form the envelope stores. */
  salt: string;
  iterations: number;
};

/** A session key for a brand-new file: fresh salt, current iteration count. */
export async function createSessionKey(passphrase: string): Promise<SessionKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  return { key, salt: toBase64(salt), iterations: PBKDF2_ITERATIONS };
}

/**
 * A session key for a file being opened: adopts the salt and iteration count
 * recorded in the envelope, so later saves stay readable by everyone else
 * working on the same file.
 *
 * Throws if the passphrase is wrong, exactly as decryptJson does.
 */
export async function openSessionKey(
  passphrase: string,
  envelope: EncryptedEnvelope
): Promise<SessionKey> {
  const salt = fromBase64(envelope.salt);
  const key = await deriveKey(passphrase, salt, envelope.iterations);
  // Prove the passphrase before handing back a key that will be trusted for
  // the rest of the session; GCM authentication fails on a wrong passphrase.
  const iv = fromBase64(envelope.iv);
  await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, fromBase64(envelope.ciphertext));
  return { key, salt: envelope.salt, iterations: envelope.iterations };
}

/**
 * Whether a session key can read this envelope.
 *
 * A false here means someone wrote the file with a different salt -- an older
 * build, or a different passphrase entirely. The caller must not overwrite a
 * file it cannot read: that is how a colleague's work disappears.
 */
export function sessionKeyCanRead(session: SessionKey, envelope: EncryptedEnvelope): boolean {
  return session.salt === envelope.salt && session.iterations === envelope.iterations;
}

export async function encryptJsonWithSessionKey(
  session: SessionKey,
  value: unknown
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.key, plaintext);
  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: session.iterations,
    salt: session.salt,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptJsonWithSessionKey<T = unknown>(
  session: SessionKey,
  envelope: EncryptedEnvelope
): Promise<T> {
  if (!sessionKeyCanRead(session, envelope)) {
    throw new Error("This file was written with a different passphrase or an older version.");
  }
  const iv = fromBase64(envelope.iv);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    session.key,
    fromBase64(envelope.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Strip everything but digits so the same PHN matches across uploads. */
export function normalizePhn(phn: string): string {
  return (phn ?? "").replace(/\D/g, "");
}
