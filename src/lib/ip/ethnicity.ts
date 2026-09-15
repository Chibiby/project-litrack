import type { Ethnicity } from "@prisma/client";

/**
 * Ethnicities counted as Indigenous Peoples (IP) on the dashboards. Defined once
 * here; every IP query and every IP breakdown reads this list. Order is the
 * display order of chart slices.
 */
export const IP_ETHNICITIES = [
  "BLAAN",
  "TAGAKAOLO",
  "TBOLI",
  "BADJAO",
  "MARANAO",
  "TAUSOG",
  "MAGUINDANAON",
] as const satisfies readonly Ethnicity[];

export type IpEthnicity = (typeof IP_ETHNICITIES)[number];

const IP_SET: ReadonlySet<string> = new Set(IP_ETHNICITIES);

export function isIpEthnicity(value: string | null | undefined): value is IpEthnicity {
  return value != null && IP_SET.has(value);
}

/** Distinct IP ethnicities a learner carries across both slots (0, 1 or 2). */
export function ipKindsOf(
  ethnicity: string | null | undefined,
  secondaryEthnicity: string | null | undefined
): IpEthnicity[] {
  const kinds: IpEthnicity[] = [];
  if (isIpEthnicity(ethnicity)) kinds.push(ethnicity);
  if (isIpEthnicity(secondaryEthnicity) && secondaryEthnicity !== ethnicity) {
    kinds.push(secondaryEthnicity);
  }
  return kinds;
}

/** A learner is IP when either ethnicity slot holds an IP value. */
export function isIpLearner(
  ethnicity: string | null | undefined,
  secondaryEthnicity: string | null | undefined
): boolean {
  return ipKindsOf(ethnicity, secondaryEthnicity).length > 0;
}
