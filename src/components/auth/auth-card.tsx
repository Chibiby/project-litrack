import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The sign-in label box: the name label printed on a DepEd module cover (see
 * LoginShell). A navy header strip names the step and, when there is more than
 * one, shows where in the order the teacher is; the white body holds the form.
 * Printed stock, so the corners stay nearly square and the depth is a soft
 * offset shadow, never a glow.
 */
export function AuthCard({
  title,
  step,
  children,
  className,
}: {
  title: string;
  /** Position in the two-step school sign-in; omitted where there is one step. */
  step?: 1 | 2;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "w-full overflow-hidden rounded-[3px] border-2 border-aral-navy bg-aral-paper lg:w-[29rem]",
        className
      )}
    >
      <header className="flex items-center justify-between gap-4 bg-aral-navy px-5 py-4 sm:px-7">
        <h2 className="min-w-0 font-module text-lg font-extrabold tracking-tight text-aral-paper [font-stretch:108%] sm:text-2xl">
          {title}
        </h2>
        {step ? <StepRail step={step} /> : null}
      </header>
      <div className="px-5 py-6 sm:px-7 sm:py-7">{children}</div>
    </section>
  );
}

const STEPS = ["School", "Account"] as const;

function StepRail({ step }: { step: 1 | 2 }) {
  return (
    <ol className="flex shrink-0 items-center gap-3 text-xs font-semibold" aria-label="Sign-in steps">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const current = n === step;
        const done = n < step;
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            className={cn("flex items-center gap-1.5", current ? "text-aral-paper" : "text-[#9FB2CF]")}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                current ? "bg-aral-paper text-aral-navy" : "ring-1 ring-inset ring-[#9FB2CF]"
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : n}
            </span>
            {/* Phones keep the header to one line: only the current step is named. */}
            <span className={current ? undefined : "sr-only sm:not-sr-only"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Field labels in the label box. */
export const AUTH_LABEL = "text-sm font-semibold text-aral-navy";

/** Text fields and pickers: printed answer boxes with a firm rule. */
export const AUTH_FIELD =
  "h-12 rounded-[3px] border-[1.5px] border-aral-edge bg-aral-paper px-3.5 sm:h-12 text-base text-aral-navy placeholder:text-aral-slate hover:border-aral-blue/60 focus-visible:border-aral-blue md:text-base";

/**
 * The live control. Sun gold is spent here and on the picked option only — the
 * one thing on the cover you can act on next.
 */
export const AUTH_PRIMARY_BUTTON =
  "h-12 w-full rounded-[3px] bg-aral-gold text-base sm:h-12 font-bold text-aral-navy shadow-[0_10px_22px_-14px_rgba(18,41,77,0.7)] hover:bg-aral-sun disabled:bg-aral-wash disabled:text-aral-slate disabled:opacity-100 disabled:shadow-none [&_svg]:size-5";

/** A two-way switch (role; sign in or create account): gold marks the pick. */
export const AUTH_SEGMENTS = "grid grid-cols-2 gap-1 rounded-[3px] border-[1.5px] border-aral-edge p-1";
export const AUTH_SEGMENT =
  "h-10 w-full rounded-[2px] border-0 text-sm font-semibold sm:text-base [&_svg]:size-[18px]";
export const AUTH_SEGMENT_ON =
  "bg-aral-gold text-aral-navy shadow-[0_1px_2px_rgba(18,41,77,0.25)] hover:bg-aral-gold hover:text-aral-navy";
/** The picked intent on the teacher step-2 tabs: navy ink, gold stays reserved for the submit button. */
export const AUTH_SEGMENT_ON_INK =
  "bg-aral-navy text-aral-paper shadow-[0_1px_2px_rgba(18,41,77,0.25)] hover:bg-aral-navy hover:text-aral-paper";
export const AUTH_SEGMENT_OFF = "bg-transparent text-aral-slate hover:bg-aral-wash hover:text-aral-navy";

/** Text links on the label box. */
export const AUTH_LINK =
  "font-semibold text-aral-blue underline decoration-aral-blue/30 underline-offset-4 hover:decoration-aral-blue";

/** The quiet footer row under a step: recovery and the other sign-in. */
export const AUTH_FOOTER =
  "mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-aral-line/60 pt-4 text-sm";

/** Turns a step's body in once, from an already-visible start. */
export const AUTH_STEP_TURN = "motion-safe:animate-module-turn";
