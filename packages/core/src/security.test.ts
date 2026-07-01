import { describe, expect, it } from "vitest";
import {
  encryptJson,
  decryptJson,
  isEncryptedEnvelope,
  generateOfficeKey,
  patientToken,
  normalizePhn,
  wrapOfficeKey,
  unwrapOfficeKey,
  sealJson,
  openSealed,
} from "./security";

describe("encryptJson / decryptJson", () => {
  it("round-trips an object with the correct passphrase", async () => {
    const value = { csvText: "Jane Doe,2w,5", slateDates: ["2026-01-08"], n: 3 };
    const envelope = await encryptJson("correct horse", value);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    // The plaintext identifier must not appear in the stored envelope.
    expect(JSON.stringify(envelope)).not.toContain("Jane Doe");
    const decrypted = await decryptJson("correct horse", envelope);
    expect(decrypted).toEqual(value);
  });

  it("rejects a wrong passphrase", async () => {
    const envelope = await encryptJson("right", { a: 1 });
    await expect(decryptJson("wrong", envelope)).rejects.toBeDefined();
  });
});

describe("patientToken", () => {
  it("is stable for the same PHN and office key, regardless of formatting", async () => {
    const key = generateOfficeKey();
    const a = await patientToken(key, "9876 543 210");
    const b = await patientToken(key, "9876-543-210");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across office keys and across PHNs", async () => {
    const k1 = generateOfficeKey();
    const k2 = generateOfficeKey();
    expect(await patientToken(k1, "9876543210")).not.toBe(await patientToken(k2, "9876543210"));
    expect(await patientToken(k1, "9876543210")).not.toBe(await patientToken(k1, "1111111111"));
  });

  it("never contains the PHN", async () => {
    const token = await patientToken(generateOfficeKey(), "9876543210");
    expect(token).not.toContain("9876543210");
  });
});

describe("normalizePhn", () => {
  it("keeps only digits", () => {
    expect(normalizePhn(" 9876-543 210 ")).toBe("9876543210");
  });
});

describe("office key wrap + state seal", () => {
  it("wraps/unwraps the office key with the passphrase (and rejects a wrong one)", async () => {
    const officeKey = generateOfficeKey();
    const wrapped = await wrapOfficeKey("office-pass", officeKey);
    expect(JSON.stringify(wrapped)).not.toContain(Array.from(officeKey).join(","));
    const unwrapped = await unwrapOfficeKey("office-pass", wrapped);
    expect(Array.from(unwrapped)).toEqual(Array.from(officeKey));
    await expect(unwrapOfficeKey("nope", wrapped)).rejects.toBeDefined();
  });

  it("seals/opens working state under the raw office key without leaking content", async () => {
    const officeKey = generateOfficeKey();
    const state = { patientState: { abc123: { unavailableUntil: "2026-08-01" } } };
    const sealed = await sealJson(officeKey, state);
    expect(JSON.stringify(sealed)).not.toContain("2026-08-01");
    expect(await openSealed(officeKey, sealed)).toEqual(state);
    await expect(openSealed(generateOfficeKey(), sealed)).rejects.toBeDefined();
  });
});
