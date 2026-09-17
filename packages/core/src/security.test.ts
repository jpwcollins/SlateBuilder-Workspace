import { describe, expect, it } from "vitest";
import {
  encryptJson,
  decryptJson,
  isEncryptedEnvelope,
  normalizePhn,
  MIN_PASSPHRASE_LENGTH,
  createSessionKey,
  openSessionKey,
  sessionKeyCanRead,
  encryptJsonWithSessionKey,
  decryptJsonWithSessionKey,
  EncryptedEnvelope,
} from "./security";

describe("encryptJson / decryptJson", () => {
  it("round-trips an object with the correct passphrase", async () => {
    const value = { unavailableUntil: "2026-08-01", phn: "9876543210", n: 3 };
    const envelope = await encryptJson("correct horse battery", value);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    // The plaintext must not appear anywhere in the stored envelope.
    expect(JSON.stringify(envelope)).not.toContain("9876543210");
    expect(JSON.stringify(envelope)).not.toContain("2026-08-01");
    const decrypted = await decryptJson("correct horse battery", envelope);
    expect(decrypted).toEqual(value);
  });

  it("rejects a wrong passphrase", async () => {
    const envelope = await encryptJson("right passphrase", { a: 1 });
    await expect(decryptJson("wrong passphrase", envelope)).rejects.toBeDefined();
  });

  it("rejects a tampered ciphertext rather than returning garbage", async () => {
    const envelope = await encryptJson("a good long passphrase", { a: 1 });
    const bytes = atob(envelope.ciphertext);
    // Flip a bit in the first byte; GCM authentication must catch it.
    const tampered = String.fromCharCode(bytes.charCodeAt(0) ^ 0x01) + bytes.slice(1);
    const bad = { ...envelope, ciphertext: btoa(tampered) };
    await expect(decryptJson("a good long passphrase", bad)).rejects.toBeDefined();
  });

  it("derives using the iteration count recorded in the envelope", async () => {
    // A file written under a lower iteration count must still open after the
    // library default is raised, so the recorded value has to be honoured.
    const envelope = await encryptJson("a good long passphrase", { a: 1 });
    expect(envelope.iterations).toBeGreaterThanOrEqual(600_000);

    const legacy: EncryptedEnvelope = { ...envelope, iterations: 1000 };
    // Re-deriving at 1000 iterations yields a different key, so this specific
    // envelope must now fail — proving the envelope's value is what is used,
    // rather than the constant.
    await expect(decryptJson("a good long passphrase", legacy)).rejects.toBeDefined();
  });

  it("recognises a malformed envelope", () => {
    expect(isEncryptedEnvelope({ alg: "AES-GCM" })).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope("nope")).toBe(false);
  });

  it("requires a passphrase long enough to resist offline guessing", () => {
    expect(MIN_PASSPHRASE_LENGTH).toBeGreaterThanOrEqual(12);
  });
});

describe("normalizePhn", () => {
  it("keeps only digits", () => {
    expect(normalizePhn(" 9876-543 210 ")).toBe("9876543210");
  });
});

describe("session keys", () => {
  const PASS = "slatebuilder-test-2026";

  it("derives once and encrypts many times, with a fresh IV each save", async () => {
    const session = await createSessionKey(PASS);
    const a = await encryptJsonWithSessionKey(session, { n: 1 });
    const b = await encryptJsonWithSessionKey(session, { n: 2 });
    // Same file, so same salt -- but never the same IV, which is what
    // AES-GCM actually requires.
    expect(a.salt).toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(await decryptJsonWithSessionKey(session, a)).toEqual({ n: 1 });
    expect(await decryptJsonWithSessionKey(session, b)).toEqual({ n: 2 });
  });

  it("still opens with the plain passphrase path", async () => {
    // Files written with a session key must stay ordinary files: openable by
    // anyone with the passphrase, including an older build.
    const session = await createSessionKey(PASS);
    const envelope = await encryptJsonWithSessionKey(session, { hello: "world" });
    expect(await decryptJson(PASS, envelope)).toEqual({ hello: "world" });
  });

  it("adopts the file's salt when opening, so colleagues can read each other", async () => {
    // The property the whole design rests on. Two people open the same file
    // and each hold their own session key; whatever one writes, the other
    // must be able to read back without retyping the passphrase.
    const original = await encryptJson(PASS, { from: "the file on disk" });

    const moa = await openSessionKey(PASS, original);
    const surgeon = await openSessionKey(PASS, original);

    const written = await encryptJsonWithSessionKey(moa, { from: "the MOA" });
    expect(sessionKeyCanRead(surgeon, written)).toBe(true);
    expect(await decryptJsonWithSessionKey(surgeon, written)).toEqual({ from: "the MOA" });
  });

  it("refuses the passphrase at the point the key is made, not later", async () => {
    const envelope = await encryptJson(PASS, { a: 1 });
    await expect(openSessionKey("the-wrong-passphrase", envelope)).rejects.toThrow();
  });

  it("will not read a file written under a different salt", async () => {
    // A save from an older build, or under a different passphrase. Refusing
    // here is what stops the app overwriting a file it cannot read.
    const session = await createSessionKey(PASS);
    const foreign = await encryptJson(PASS, { written: "elsewhere" });
    expect(sessionKeyCanRead(session, foreign)).toBe(false);
    await expect(decryptJsonWithSessionKey(session, foreign)).rejects.toThrow();
  });

  it("keeps the key non-extractable", async () => {
    const session = await createSessionKey(PASS);
    expect(session.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", session.key)).rejects.toThrow();
  });
});
