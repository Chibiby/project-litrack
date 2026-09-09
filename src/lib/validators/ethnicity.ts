import { z } from "zod";

/**
 * The ethnicity question, shared by the learner form, the learner CSV import
 * and the teacher profiling wizard. All three ask it the same way, so the
 * option list and the conditional rules live here rather than three times over.
 *
 * Two slots, not a list: a person may record one ethnicity or two. The second
 * is optional, may only hold a value when the first does, and may not repeat
 * the first. Either slot chooses "Others", in which case that slot carries its
 * own free text.
 */
export const ETHNICITY = [
  "BISAYA", "ILONGGO", "BLAAN", "TAGAKAOLO", "TBOLI", "BADJAO", "MARANAO",
  "TAUSOG", "MAGUINDANAON", "ILOCANO", "TAGALOG", "FOREIGN", "OTHER",
] as const;

export type EthnicityValue = (typeof ETHNICITY)[number];

/** Empty string / null → undefined, the way an unfilled select posts. */
const optionalEthnicityEnum = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.enum(ETHNICITY).optional()
);

const optionalEthnicityOther = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal("").transform(() => undefined));

/** The four columns, ready to spread into an object schema. */
export const ethnicityFields = {
  ethnicity: optionalEthnicityEnum,
  ethnicityOther: optionalEthnicityOther,
  secondaryEthnicity: optionalEthnicityEnum,
  secondaryEthnicityOther: optionalEthnicityOther,
};

export type EthnicityPair = {
  ethnicity?: EthnicityValue;
  ethnicityOther?: string;
  secondaryEthnicity?: EthnicityValue;
  secondaryEthnicityOther?: string;
};

type EthnicityRefineOptions = {
  /**
   * "form" — a details line filled in with no ethnicity chosen is an error, so
   * the field the person can see gets a message.
   *
   * "import" — the same stray details are ignored. A spreadsheet may carry a
   * note in the details column of a row whose ethnicity cell is blank, and
   * failing the whole row over it helps nobody.
   */
  variant?: "form" | "import";
};

/** Case- and space-insensitive, so "Manobo" and "  manobo " are one answer. */
function normalizeOther(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Are the two slots the same answer? Two "Others" only collide when they name
 * the same people — someone of mixed heritage may well have to write both
 * halves into the free-text lines.
 */
function isRepeat(data: EthnicityPair): boolean {
  if (data.ethnicity == null || data.secondaryEthnicity == null) return false;
  if (data.ethnicity !== data.secondaryEthnicity) return false;
  if (data.ethnicity !== "OTHER") return true;
  return normalizeOther(data.ethnicityOther) === normalizeOther(data.secondaryEthnicityOther);
}

/**
 * Both slots at once. Attach with `.superRefine((d, ctx) => refineEthnicityPair(d, ctx))`.
 */
export function refineEthnicityPair(
  data: EthnicityPair,
  ctx: z.RefinementCtx,
  options: EthnicityRefineOptions = {}
): void {
  const isImport = options.variant === "import";

  // --- first slot -----------------------------------------------------------
  if (data.ethnicity === "OTHER" && !data.ethnicityOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: isImport ? "Specify ethnicity when Others is selected" : "Please specify the ethnicity",
      path: ["ethnicityOther"],
    });
  }
  if (
    data.ethnicity !== "OTHER" &&
    data.ethnicityOther?.trim() &&
    !(isImport && data.ethnicity == null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Ethnicity details are only allowed when Others is selected",
      path: ["ethnicityOther"],
    });
  }

  // --- second slot ----------------------------------------------------------
  if (data.secondaryEthnicity != null && data.ethnicity == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose the first ethnicity before adding another",
      path: ["secondaryEthnicity"],
    });
  }
  if (isRepeat(data)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The second ethnicity must be different from the first",
      path: data.ethnicity === "OTHER" ? ["secondaryEthnicityOther"] : ["secondaryEthnicity"],
    });
  }
  if (data.secondaryEthnicity === "OTHER" && !data.secondaryEthnicityOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: isImport
        ? "Specify the second ethnicity when Others is selected"
        : "Please specify the second ethnicity",
      path: ["secondaryEthnicityOther"],
    });
  }
  if (
    data.secondaryEthnicity !== "OTHER" &&
    data.secondaryEthnicityOther?.trim() &&
    !(isImport && data.secondaryEthnicity == null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Second ethnicity details are only allowed when Others is selected",
      path: ["secondaryEthnicityOther"],
    });
  }
}

/**
 * The four columns as Prisma wants them: `null` rather than `undefined`, and
 * each free-text line cleared unless its own slot chose "Others".
 *
 * A slot that loses its selection loses its details with it, and dropping the
 * first ethnicity drops the second — so no edit can leave a stale specify line,
 * or a second ethnicity, stranded behind an answer that is no longer there.
 */
export function ethnicityColumns(data: EthnicityPair) {
  const hasFirst = data.ethnicity != null;
  const secondary = hasFirst ? (data.secondaryEthnicity ?? null) : null;
  return {
    ethnicity: data.ethnicity ?? null,
    ethnicityOther:
      data.ethnicity === "OTHER" ? (data.ethnicityOther?.trim() || null) : null,
    secondaryEthnicity: secondary,
    secondaryEthnicityOther:
      secondary === "OTHER" ? (data.secondaryEthnicityOther?.trim() || null) : null,
  };
}
