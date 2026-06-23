import { describe, expect, it } from "vitest";
import { encryptJson, decryptJson, isEncryptedEnvelope } from "./security";

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
