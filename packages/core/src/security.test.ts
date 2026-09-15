import { describe, expect, it } from "vitest";
import {
  encryptJson,
  decryptJson,
  isEncryptedEnvelope,
  normalizePhn,
  MIN_PASSPHRASE_LENGTH,
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
