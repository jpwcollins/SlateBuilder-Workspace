// A strength check for the passphrase that protects a notes file.
//
// The file's encryption is only as strong as this passphrase: anyone who gets a
// copy of the file can guess offline, as fast as their hardware allows, with no
// lockout. A 12-character minimum alone still admits "Password1234" and
// "Summer2026!!", which sit near the top of every guessing list.
//
// This is deliberately not a full entropy estimator. It catches the patterns
// that guessing tools try first -- one common word decorated with digits and
// symbols, keyboard runs, repetition -- and steers people towards the form
// that is both strong and memorable: four or five random words joined by
// hyphens. It only applies when a passphrase is being *set*; opening an
// existing file must accept whatever passphrase that file was written with.

import { MIN_PASSPHRASE_LENGTH } from "./security";

export type PassphraseLevel = "weak" | "fair" | "strong";

export type PassphraseAssessment = {
  /** False only for "weak": the app refuses to create a file with it. */
  ok: boolean;
  level: PassphraseLevel;
  message: string;
};

export const PASSPHRASE_EXAMPLE = "harbour-velvet-spoon-orbit";

const SUGGESTION = `Try 4 or 5 random words joined by hyphens, like ${PASSPHRASE_EXAMPLE}.`;

// Words that appear in almost every guessing list, plus the ones an office
// using this tool would reach for first. Matched as substrings after
// lowercasing and undoing common letter-for-digit swaps.
const COMMON_WORDS = [
  "password",
  "passphrase",
  "letmein",
  "welcome",
  "qwerty",
  "admin",
  "administrator",
  "login",
  "secret",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "hockey",
  "canada",
  "vancouver",
  "victoria",
  "slatebuilder",
  "slate",
  "builder",
  "clinic",
  "office",
  "surgery",
  "surgeon",
  "hospital",
  "doctor",
  "nurse",
  "patient",
  "phsa",
  "bcwomens",
  "womens",
  "waitlist",
  "booking",
  "notes",
  "spring",
  "summer",
  "autumn",
  "fall",
  "winter",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
].sort((a, b) => b.length - a.length);

const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890",
  "01234567890",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

function removeSequences(value: string): string {
  let out = value;
  for (const seq of SEQUENCES) {
    for (const source of [seq, [...seq].reverse().join("")]) {
      for (let len = source.length; len >= 4; len -= 1) {
        for (let start = 0; start + len <= source.length; start += 1) {
          const run = source.slice(start, start + len);
          if (out.includes(run)) out = out.split(run).join(" ");
        }
      }
    }
  }
  return out;
}

/** Letters that remain once the predictable parts are taken out. */
function unpredictableLetters(passphrase: string): number {
  let s = passphrase.toLowerCase();
  // Sequences first, on the raw text, so "1234" is not leet-mapped to "ize".
  s = removeSequences(s);
  s = [...s].map((c) => LEET[c] ?? c).join("");
  for (const word of COMMON_WORDS) {
    if (s.includes(word)) s = s.split(word).join(" ");
  }
  s = removeSequences(s);
  // Runs of one repeated letter ("aaaa") add nothing.
  s = s.replace(/(.)\1{2,}/g, "$1");
  return (s.match(/[a-z]/g) ?? []).length;
}

/** Alphabetic words, split on anything that is not a letter and on camelCase. */
function words(passphrase: string): string[] {
  return passphrase
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

export function assessPassphrase(passphrase: string): PassphraseAssessment {
  const weak = (message: string): PassphraseAssessment => ({
    ok: false,
    level: "weak",
    message,
  });

  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return weak(
      `Too short: use at least ${MIN_PASSPHRASE_LENGTH} characters. ${SUGGESTION}`,
    );
  }

  if (new Set(passphrase.toLowerCase()).size < 6) {
    return weak(`Too repetitive. ${SUGGESTION}`);
  }

  if (unpredictableLetters(passphrase) < 8) {
    return weak(
      `Too easy to guess: it is built from common words, keyboard runs or number patterns. ${SUGGESTION}`,
    );
  }

  // A random string, as a password manager generates: many distinct
  // characters across several classes. Hard to remember, but not weak.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(passphrase),
  ).length;
  const longestLetterRun = Math.max(
    0,
    ...(passphrase.match(/[A-Za-z]+/g) ?? []).map((r) => r.length),
  );
  if (classes >= 3 && new Set(passphrase).size >= 12 && longestLetterRun <= 4) {
    return passphrase.length >= 16
      ? { ok: true, level: "strong", message: "Strong passphrase." }
      : {
          ok: true,
          level: "fair",
          message: `Acceptable, but could be stronger. ${SUGGESTION}`,
        };
  }

  const parts = words(passphrase);
  const longest = parts.reduce((max, w) => Math.max(max, w.length), 0);
  if (
    parts.length <= 1 ||
    (parts.filter((w) => w.length >= 3).length <= 1 && longest < 16)
  ) {
    return weak(
      `Too easy to guess: one word with numbers or symbols added is among the first things tried. ${SUGGESTION}`,
    );
  }

  const distinctWords = new Set(parts.filter((w) => w.length >= 3));
  if (distinctWords.size >= 4) {
    return { ok: true, level: "strong", message: "Strong passphrase." };
  }

  return {
    ok: true,
    level: "fair",
    message: `Acceptable, but could be stronger. ${SUGGESTION}`,
  };
}
