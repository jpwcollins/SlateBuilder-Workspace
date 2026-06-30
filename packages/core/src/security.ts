// Passphrase-based encryption for any saved work that may contain patient
// identifiers (named saves, exported session files). Runs entirely in the
// browser via WebCrypto. Mirrors the "password-protected file" model the
// offices already use: one passphrase to lock, the same to unlock.
//
// AES-256-GCM (authenticated) with a key derived from the passphrase via
// PBKDF2-SHA256. A random salt and IV are stored alongside the ciphertext; the
// passphrase itself is never persisted.

export type EncryptedEnvelope = {
  v: 1;
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
};

const PBKDF2_ITERATIONS = 200_000;

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

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(passphrase: string, value: unknown): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
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
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EncryptedEnvelope).alg === "AES-GCM" &&
    typeof (value as EncryptedEnvelope).ciphertext === "string"
  );
}

/**
 * Decrypts an envelope produced by {@link encryptJson}. Throws if the
 * passphrase is wrong or the data was tampered with (GCM authentication fails).
 */
export async function decryptJson<T = unknown>(
  passphrase: string,
  envelope: EncryptedEnvelope
): Promise<T> {
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt);
  const ciphertext = fromBase64(envelope.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// ----------------------------------------------------------------------------
// Pseudonymized cloud-sync primitives.
//
// A patient token is a non-reversible HMAC of the (normalized) PHN under a
// per-office secret key that never leaves the browser, so the same patient maps
// to the same token across uploads and devices while the server can neither
// compute nor reverse it. The office key is wrapped with the office passphrase
// for storage (so a password change does not rotate tokens), and the working
// state is sealed under the raw office key for end-to-end encryption.
// ----------------------------------------------------------------------------

export type SealedBlob = {
  v: 1;
  alg: "AES-GCM";
  iv: string; // base64
  ciphertext: string; // base64
};

export function bytesToBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

/** Strip everything but digits so the same PHN matches across exports. */
export function normalizePhn(phn: string): string {
  return (phn ?? "").replace(/\D/g, "");
}

/** A fresh random 256-bit office key (held only in the browser). */
export function generateOfficeKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * A non-secret check value (SHA-256 of the office key) the server can store to
 * authorize a recovery-code password reset without ever learning the key. The
 * key is 256-bit random, so the digest reveals nothing useful.
 */
export async function keyCheckValue(officeKey: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", officeKey);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable, non-reversible patient token = HMAC-SHA256(officeKey, normPHN). */
export async function patientToken(officeKey: Uint8Array, phn: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    officeKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalizePhn(phn)));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Encrypt the office key with the passphrase (PBKDF2) for server storage. */
export async function wrapOfficeKey(
  passphrase: string,
  officeKey: Uint8Array
): Promise<EncryptedEnvelope> {
  return encryptJson(passphrase, toBase64(officeKey));
}

export async function unwrapOfficeKey(
  passphrase: string,
  envelope: EncryptedEnvelope
): Promise<Uint8Array> {
  return fromBase64(await decryptJson<string>(passphrase, envelope));
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Seal a JSON value under the raw office key (end-to-end encrypted blob). */
export async function sealJson(officeKey: Uint8Array, value: unknown): Promise<SealedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(officeKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return {
    v: 1,
    alg: "AES-GCM",
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function openSealed<T = unknown>(
  officeKey: Uint8Array,
  blob: SealedBlob
): Promise<T> {
  const iv = fromBase64(blob.iv);
  const key = await importAesKey(officeKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    fromBase64(blob.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
