"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Collapsible form sections with per-section ticks and an overall completion
 * bar, for long forms rendered inside a dialog.
 *
 * Hand-rolled on purpose: no Radix accordion or progress package is installed,
 * and adding one would mean touching `.npmrc`'s legacy-peer-deps setup and the
 * React type overrides in package.json. This follows the same route as the
 * profile dialog's tab strip.
 *
 * TWO THINGS THAT LOOK LIKE STYLE BUT ARE NOT
 *
 *  - A collapsed section is `hidden`, not unmounted. Its controls stay in the
 *    DOM so `new FormData(form)` still reads them and a collapsed section's
 *    answers still submit. Unmounting would silently drop them.
 *  - Because those controls are in the DOM but not focusable, the browser
 *    cannot report a native validation failure on one (Chrome refuses to
 *    submit and only logs "not focusable"). So the submit button must check
 *    completeness itself and open the offending section — see the intercept in
 *    learner-form.tsx. `formProgress` exists to make that check cheap.
 */

/**
 * The form's current values, keyed by control name, holding only entries that
 * actually carry text. A name absent from the snapshot is an empty field, so
 * completeness is a key lookup rather than a value comparison.
 */
export type FormValues = Record<string, string>;

export type FormSectionDef = {
  key: string;
  title: string;
  /** One line under the title saying what belongs in the section. */
  hint?: string;
  /**
   * Names that must carry a value for this section to be complete, given the
   * current snapshot. Conditional requirements belong here: the DepEd form only
   * demands "Specify transfers" once Multiple is chosen, so that field joins the
   * list at that moment and the completion bar dips — correctly, because
   * choosing Multiple created new work.
   *
   * A section whose list is empty for the current values requires nothing and is
   * labelled Optional rather than ticked; a tick that appears before the teacher
   * has opened a section would read as "already done".
   */
  requiredFields: (values: FormValues) => readonly string[];
};

/** A section paired with the fields it discloses. */
export type RenderedFormSection = FormSectionDef & { content: ReactNode };

export type SectionProgress = {
  /** How many names this section requires right now. */
  required: number;
  filled: number;
  /** Names still empty, in declaration order. */
  missing: string[];
  complete: boolean;
  /** Nothing is required here at the moment. */
  optional: boolean;
};

/**
 * The section a control belongs to, read off the region it renders in. Lets the
 * submit intercept expand the section owning a failing field without keeping a
 * second field-to-section map in sync with the JSX.
 */
export function sectionKeyOf(el: Element): string | null {
  return el.closest("[data-section-key]")?.getAttribute("data-section-key") ?? null;
}

/** Reads the form's live values. Only non-blank entries are kept. */
export function snapshotForm(form: HTMLFormElement): FormValues {
  const values: FormValues = {};
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value === "string" && value.trim().length > 0) {
      values[name] = value;
    }
  }
  return values;
}

export function sectionProgress(
  section: FormSectionDef,
  values: FormValues
): SectionProgress {
  const required = section.requiredFields(values);
  const missing = required.filter((name) => !(name in values));
  return {
    required: required.length,
    filled: required.length - missing.length,
    missing,
    complete: missing.length === 0,
    optional: required.length === 0,
  };
}

/**
 * Completion across every section, counted by field rather than by section, so
 * filling four of five names moves the bar instead of waiting for the fifth.
 *
 * `complete` is the only honest promise a completion bar can make here: it is
 * true exactly when the form has everything the server requires.
 */
export function formProgress<T extends FormSectionDef>(
  sections: readonly T[],
  values: FormValues
): {
  filled: number;
  total: number;
  percent: number;
  /** Sections still missing a required field, in declaration order. */
  incomplete: T[];
  complete: boolean;
} {
  let filled = 0;
  let total = 0;
  const incomplete: T[] = [];

  for (const section of sections) {
    const progress = sectionProgress(section, values);
    filled += progress.filled;
    total += progress.required;
    if (!progress.complete) incomplete.push(section);
  }

  return {
    filled,
    total,
    // A form with nothing required is complete, not zero percent done.
    percent: total === 0 ? 100 : Math.round((filled / total) * 100),
    incomplete,
    complete: incomplete.length === 0,
  };
}

/**
 * The completion meter. Counts required fields, so `aria-valuemax` is a real
 * total rather than a percentage — a screen reader hears "3 of 7 required
 * fields filled", which is what the bar means.
 */
export function FormProgressBar({
  filled,
  total,
  percent,
  label = "Completion",
  className,
}: {
  filled: number;
  total: number;
  percent: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {filled}/{total} required
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`${filled} of ${total} required fields filled`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function FormSections({
  sections,
  values,
  openKey,
  onOpenKeyChange,
  idPrefix,
}: {
  sections: readonly RenderedFormSection[];
  values: FormValues;
  /** Key of the expanded section; `""` collapses all of them. */
  openKey: string;
  onOpenKeyChange: (key: string) => void;
  /** Namespace for header/region ids — two forms can be mounted at once. */
  idPrefix: string;
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {sections.map((section, index) => {
        const progress = sectionProgress(section, values);
        const isOpen = section.key === openKey;
        const headerId = `${idPrefix}-${section.key}-header`;
        const regionId = `${idPrefix}-${section.key}-panel`;

        return (
          <section key={section.key}>
            <h3>
              <button
                type="button"
                id={headerId}
                aria-expanded={isOpen}
                aria-controls={regionId}
                onClick={() => onOpenKeyChange(isOpen ? "" : section.key)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isOpen && "bg-muted/40"
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    progress.complete
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {progress.complete && !progress.optional ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    index + 1
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {section.title}
                  </span>
                  {section.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {section.hint}
                    </span>
                  ) : null}
                </span>

                <SectionStatus progress={progress} title={section.title} />

                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                    isOpen && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
            </h3>

            {/* Hidden, never unmounted: a collapsed section's answers must
                still reach FormData on submit. `data-section-key` is how the
                submit intercept finds the section owning a failing control. */}
            <div
              id={regionId}
              role="region"
              aria-labelledby={headerId}
              data-section-key={section.key}
              hidden={!isOpen}
              className="space-y-4 border-t border-border/60 px-4 py-4"
            >
              {section.content}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The header's right-hand status. Three states, and the distinction between the
 * first two is the point: "Optional" means the section can never block a save,
 * while a tick means required fields were answered.
 */
function SectionStatus({
  progress,
  title,
}: {
  progress: SectionProgress;
  title: string;
}) {
  if (progress.optional) {
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        Optional
      </span>
    );
  }
  if (progress.complete) {
    return (
      <span className="shrink-0 text-[11px] font-medium text-primary">
        Complete
        <span className="sr-only"> — {title}</span>
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
      {progress.missing.length} left
      <span className="sr-only"> in {title}</span>
    </span>
  );
}
