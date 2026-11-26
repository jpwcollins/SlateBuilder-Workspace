import { describe, expect, it } from "vitest";
import { assessPassphrase, PASSPHRASE_EXAMPLE } from "./passphrase";

describe("assessPassphrase", () => {
  it.each([
    "short-one",
    "Password1234",
    "P@ssw0rd2026!",
    "Summer2026!!",
    "qwerty123456",
    "abcdefgh1234",
    "aaaaaaaaaaaaaaaa",
    "121212121212",
    "SlateBuilder2026",
    "Welcome2Clinic!",
    "Vancouver#2026",
    "Monkey!!!!!!12",
  ])("rejects %s", (p) => {
    const result = assessPassphrase(p);
    expect(result.ok).toBe(false);
    expect(result.level).toBe("weak");
  });

  it.each([
    PASSPHRASE_EXAMPLE,
    "harbour-velvet-spoon-orbit-cactus",
    "Correct Horse Battery Staple",
    "tulipMarbleKettleGranite",
    "kx9-Tq2v-Lm8w-Zp",
    // Apple's generated format
    "qejfep-dAnraf-0vugmu",
    "Bymhic-5ruxko-satcog",
    // Chrome's generated format (15 characters)
    "Xk9mQ2pLr7vWz3T",
    "aR4vNq8eLx2Wmt7",
  ])("rates %s strong", (p) => {
    expect(assessPassphrase(p)).toMatchObject({ ok: true, level: "strong" });
  });

  it.each(["harbour-velvet-spoon", "orange giraffe 7731", "kx9Tq2vLm8wZ"])(
    "accepts %s as fair",
    (p) => {
      expect(assessPassphrase(p)).toMatchObject({ ok: true, level: "fair" });
    },
  );

  it.each(["Harbour Velvet 99", "orange giraffe 7731"])(
    "does not mistake %s for a random string",
    (p) => {
      expect(assessPassphrase(p).level).not.toBe("strong");
    },
  );

  it("suggests hyphenated words when it rejects", () => {
    expect(assessPassphrase("Password1234").message).toContain(
      "4 or 5 random words joined by hyphens",
    );
  });
});
