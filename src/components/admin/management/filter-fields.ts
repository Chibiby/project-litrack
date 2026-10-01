import type {
  DistrictOption,
  GradeOption,
  SchoolOption,
  SectionOption,
} from "@/lib/admin/management";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";

/**
 * Builders for the Management pages' contextual filters. The cascade is
 * district → school → grade → section: changing a filter clears every filter
 * below it that could now point at a row outside the new choice.
 */

export function districtField(
  options: DistrictOption[],
  value: string | undefined,
  clears: readonly string[] = []
): ListFilterField {
  return {
    key: "district",
    label: "District",
    allLabel: "All districts",
    value: value ?? "",
    searchable: true,
    clears,
    options: options.map((d) => ({
      value: d.district,
      label: d.district,
      hint: `${d.schools} ${d.schools === 1 ? "school" : "schools"}`,
    })),
  };
}

export function schoolField(
  options: SchoolOption[],
  value: string | undefined,
  clears: readonly string[] = []
): ListFilterField {
  return {
    key: "schoolId",
    label: "School",
    allLabel: "All schools",
    value: value ?? "",
    searchable: true,
    clears,
    options: options.map((s) => ({
      value: s.id,
      label: s.name,
      hint: [s.schoolIdCode, s.district].filter(Boolean).join(" · "),
    })),
  };
}

export function gradeField(
  options: GradeOption[],
  value: string | undefined,
  clears: readonly string[] = []
): ListFilterField {
  return {
    key: "grade",
    label: "Grade",
    allLabel: "All grades",
    value: value ?? "",
    clears,
    options: options.map((g) => ({ value: g.value, label: g.label })),
  };
}

/** Section only makes sense inside one school, so it stays disabled until one is chosen. */
export function sectionField(
  options: SectionOption[],
  value: string | undefined,
  scope: { schoolId: string | undefined; grade: string | undefined }
): ListFilterField {
  const emptyReason = scope.grade
    ? "This school has no sections in the chosen grade."
    : "This school has no sections yet.";
  return {
    key: "section",
    label: "Section",
    allLabel: "All sections",
    value: scope.schoolId ? value ?? "" : "",
    searchable: true,
    disabledReason: scope.schoolId
      ? options.length === 0
        ? emptyReason
        : undefined
      : "Choose a school first.",
    options: options.map((s) => ({ value: s.id, label: s.name, hint: s.gradeLabel })),
  };
}

export function yesNoField(
  key: string,
  label: string,
  value: boolean | undefined,
  labels: { all: string; yes: string; no: string },
  help?: string
): ListFilterField {
  return {
    key,
    label,
    help,
    allLabel: labels.all,
    value: value === true ? "yes" : value === false ? "no" : "",
    options: [
      { value: "yes", label: labels.yes },
      { value: "no", label: labels.no },
    ],
  };
}

/**
 * "Whole division", or the district / school the figures are narrowed to, so
 * a stat card never reads as a division total when it is not one.
 */
export function scopeLabel(opts: {
  district?: string;
  schoolId?: string;
  schools?: SchoolOption[];
  extra?: string[];
}): string {
  const parts: string[] = [];
  if (opts.schoolId) {
    const school = opts.schools?.find((s) => s.id === opts.schoolId);
    parts.push(school ? school.name : "One school");
  } else if (opts.district) {
    parts.push(`${opts.district} district`);
  }
  parts.push(...(opts.extra ?? []));
  return parts.length > 0 ? parts.join(" · ") : "Whole division";
}
