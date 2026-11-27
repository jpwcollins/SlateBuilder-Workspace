// Which default case length a procedure gets.
//
// The hospital's SURG_DESC names come from a fixed list, so the names seen in
// a year of its procedures are classified one by one below. Anything not on
// that list falls back to the words in its name (hysterectomy, hysteroscopy,
// laparoscopic), and anything still unrecognised gets the Other – major
// length: overestimating leaves spare time, underestimating overruns a list.
//
// Where the category rests on an assumption (a name with no surgical approach
// taken as laparoscopic, an ambiguous name read one way, an unknown name given
// the longest Other length), the classification carries a note so the office
// can see it and correct the case if it is wrong.

import { DefaultDurations } from "./types";

export type ProcedureCategory =
  | "hysteroscopy"
  | "laparoscopy"
  | "hysterectomy"
  | "otherMinor"
  | "otherIntermediate"
  | "otherMajor";

export const PROCEDURE_CATEGORY_LABELS: Record<ProcedureCategory, string> = {
  hysteroscopy: "Hysteroscopy",
  laparoscopy: "Laparoscopy",
  hysterectomy: "Hysterectomy",
  otherMinor: "Other – minor",
  otherIntermediate: "Other – intermediate",
  otherMajor: "Other – major",
};

export type ProcedureClassification = {
  category: ProcedureCategory;
  /** Set when the category is an assumption the office should know about. */
  assumption?: string;
};

const NO_APPROACH = "No approach given in the procedure name: taken as laparoscopic.";

// Keys are lower-case with single spaces. Only names whose category is not
// already clear from "hysterectomy", "hysteroscop" or "laparoscop" are listed.
const KNOWN: Record<string, ProcedureClassification> = {
  // Other – minor
  "insertion intrauterine device": { category: "otherMinor" },
  "removal intrauterine device": { category: "otherMinor" },
  "insertion contraceptive implant": { category: "otherMinor" },
  "removal contraceptive implant": { category: "otherMinor" },
  "injection depopravera": { category: "otherMinor" },
  "injection therapeutic agent": { category: "otherMinor" },
  "dilatation and curettage": { category: "otherMinor" },
  "dilatation and curettage - (spontaneous abortion)": { category: "otherMinor" },
  "dilatation and curettage - retained poc": { category: "otherMinor" },
  "dilatation and curettage - non-pregnant": { category: "otherMinor" },
  "dilatation and curettage with manual vacuum aspiration": { category: "otherMinor" },
  "dilatation and evacuation - (spontaneous abortion)": { category: "otherMinor" },
  "biopsy endometrium": { category: "otherMinor" },
  "ablation endometrium": { category: "otherMinor" },
  "examination under anesthesia": { category: "otherMinor" },
  "pap smear": { category: "otherMinor" },
  "insertion laminaria": { category: "otherMinor" },
  "insertion balloon catheter intrauterine": { category: "otherMinor" },
  "incision and drainage perineum": { category: "otherMinor" },
  "excision lesion vulva": { category: "otherMinor" },
  "excision lesion vagina": { category: "otherMinor" },
  "excision lesion labia": { category: "otherMinor" },
  "excision lesion cervix": { category: "otherMinor" },
  "biopsy vulva": { category: "otherMinor" },
  "biopsy cervix": { category: "otherMinor" },
  "cauterization cervix": { category: "otherMinor" },
  "excision loop electrode": { category: "otherMinor" },
  "marsupialization bartholin cyst": { category: "otherMinor" },
  "hymenotomy": { category: "otherMinor" },
  "cystoscopy": { category: "otherMinor" },
  "cystoscopy and dilatation urethra": { category: "otherMinor" },
  "cystoscopy with bulking periurethral injection": { category: "otherMinor" },
  // Other – intermediate
  "repair rectocele": { category: "otherIntermediate" },
  "repair cystocele": { category: "otherIntermediate" },
  "perineorrhaphy": { category: "otherIntermediate" },
  "sling suburethral transobturator tape": { category: "otherIntermediate" },
  "sling bladder transvaginal tape": { category: "otherIntermediate" },
  "labiaplasty": { category: "otherIntermediate" },
  "vaginoplasty": {
    category: "otherIntermediate",
    assumption: "Vaginoplasty taken as a vaginal repair, not creation of a vagina.",
  },
  "vaginoplasty with removal septum": { category: "otherIntermediate" },
  "vestibulectomy": { category: "otherIntermediate" },
  "myomectomy vaginal": { category: "otherIntermediate" },
  "removal mesh vagina": { category: "otherIntermediate" },
  "laparotomy mini": { category: "otherIntermediate" },
  "revision scar abdomen": { category: "otherIntermediate" },
  "evacuation hematoma": { category: "otherIntermediate" },
  "repair perineal laceration": { category: "otherIntermediate" },
  "repair tear vagina": { category: "otherIntermediate" },
  "repair vaginal cervical laceration": { category: "otherIntermediate" },
  // Other – major
  "repair cystocele and rectocele": { category: "otherMajor" },
  "colpocleisis": { category: "otherMajor" },
  "suspension ligament uterosacral": { category: "otherMajor" },
  "repair vaginal apical": { category: "otherMajor" },
  "sacrocolpopexy abdominal": { category: "otherMajor" },
  "sling suburethral with autologous graft": { category: "otherMajor" },
  "colporrhaphy anterior and posterior with sling suburethral trans obturator tape": {
    category: "otherMajor",
  },
  "myomectomy abdominal": { category: "otherMajor" },
  "laparotomy exploratory": { category: "otherMajor" },
  "reanastamosis fallopian tube bilateral": { category: "otherMajor" },
  // No approach in the name: at this day-surgery site, laparoscopic.
  "lysis adhesions": { category: "laparoscopy", assumption: NO_APPROACH },
  "cystectomy": {
    category: "laparoscopy",
    assumption: "Taken as a laparoscopic ovarian cystectomy (no approach or organ in the name).",
  },
  "excision cyst ovary": { category: "laparoscopy", assumption: NO_APPROACH },
  "salpingo oophorectomy": { category: "laparoscopy", assumption: NO_APPROACH },
  "surgical removal of ovaries": { category: "laparoscopy", assumption: NO_APPROACH },
  "salpingectomy": { category: "laparoscopy", assumption: NO_APPROACH },
  "salpingostomy": { category: "laparoscopy", assumption: NO_APPROACH },
  "tuboplasty": { category: "laparoscopy", assumption: NO_APPROACH },
  "appendectomy": { category: "laparoscopy", assumption: NO_APPROACH },
};

const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Rows marked "Procedure Not Performed" are not cases to plan. */
export function isProcedureNotPerformed(name: string | undefined): boolean {
  return /^procedure not performed\b/.test(normalize(name ?? ""));
}

export function classifyProcedure(name: string | undefined): ProcedureClassification {
  const key = normalize(name ?? "");
  if (!key) {
    return {
      category: "otherMajor",
      assumption: "No procedure given: given the Other – major length.",
    };
  }
  const known = KNOWN[key];
  if (known) return known;
  if (key.includes("hysterectomy")) return { category: "hysterectomy" };
  if (key.includes("hysteroscop")) return { category: "hysteroscopy" };
  if (key.includes("laparoscop")) return { category: "laparoscopy" };
  return {
    category: "otherMajor",
    assumption: "Not a procedure the app recognises: given the Other – major length to be safe.",
  };
}

/** The built-in starting estimates, before any office changes them. */
export const STANDARD_DURATIONS: Required<DefaultDurations> = {
  hysteroscopy: 30,
  laparoscopy: 60,
  hysterectomy: 180,
  otherMinor: 30,
  otherIntermediate: 60,
  other: 90,
};

/** Minutes for a category. `other` is the Other – major length. */
export function minutesForCategory(
  category: ProcedureCategory,
  durations: DefaultDurations
): number {
  switch (category) {
    case "hysteroscopy":
      return durations.hysteroscopy;
    case "laparoscopy":
      return durations.laparoscopy;
    case "hysterectomy":
      return durations.hysterectomy;
    case "otherMinor":
      return durations.otherMinor ?? STANDARD_DURATIONS.otherMinor;
    case "otherIntermediate":
      return durations.otherIntermediate ?? STANDARD_DURATIONS.otherIntermediate;
    case "otherMajor":
      return durations.other;
  }
}
