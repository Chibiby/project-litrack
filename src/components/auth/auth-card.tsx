import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SunDoodle } from "@/components/auth/story-doodles";

/**
 * The sign-in card: a friendly picture-book page. A pale-sunshine header
 * names the step and, when there is more than one, shows where in the order
 * the teacher is; the paper body holds the form. Rounded and chunky, with a
 * solid navy "stacked book" offset shadow instead of a soft glow.
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
        "w-full overflow-hidden rounded-[28px] border-[3px] border-aral-navy bg-aral-paper shadow-[0_6px_0_0_#12294D] lg:w-[30rem]",
        className
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b-[3px] border-aral-navy bg-aral-sunlight px-5 py-4 sm:px-7">
        <h2 className="flex min-w-0 items-center gap-2 font-story text-xl font-extrabold tracking-tight text-aral-navy sm:text-2xl">
          <SunDoodle className="size-7 sm:size-8" />
          <span className="min-w-0">{title}</span>
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
    <ol className="flex shrink-0 items-center gap-2" aria-label="Sign-in steps">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const current = n === step;
        const done = n < step;
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-bold",
              current
                ? "border-aral-navy bg-aral-gold text-aral-navy"
                : done
                  ? "border-aral-navy bg-aral-blue text-aral-paper"
                  : "border-aral-edge bg-aral-paper text-aral-slate"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-xs leading-none tabular-nums",
                current ? "bg-aral-paper text-aral-navy" : done ? "bg-aral-paper text-aral-blue" : ""
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

/** Field labels in the card. */
export const AUTH_LABEL = "text-sm font-semibold text-aral-navy";

/** Text fields and pickers: rounded, chunky, with a friendly focus ring. */
export const AUTH_FIELD =
  "h-12 rounded-2xl border-2 border-aral-edge bg-aral-paper px-4 sm:h-12 text-base text-aral-navy placeholder:text-aral-slate hover:border-aral-blue/60 focus-visible:border-aral-blue focus-visible:ring-4 focus-visible:ring-aral-blue/15 md:text-base";

/**
 * The primary action. Sun gold with a stacked-book offset shadow and a gentle
 * lift on hover; the ArrowRight icon nudges forward via `group-hover`.
 */
export const AUTH_PRIMARY_BUTTON =
  "group h-[3.25rem] sm:h-14 w-full rounded-full border-2 border-aral-navy bg-aral-gold font-story text-lg font-extrabold text-aral-navy shadow-[0_4px_0_0_#12294D] transition-[transform,box-shadow,background-color] duration-150 hover:bg-aral-sun motion-safe:hover:-translate-y-0.5 hover:shadow-[0_6px_0_0_#12294D] active:translate-y-[2px] active:shadow-[0_2px_0_0_#12294D] disabled:bg-aral-wash disabled:text-aral-slate disabled:border-aral-edge disabled:opacity-100 disabled:shadow-none disabled:hover:translate-y-0 [&_svg]:size-5 [&_svg]:motion-safe:group-hover:animate-story-nudge";

/** A two-way switch (role; sign in or create account): two standalone tiles. */
export const AUTH_SEGMENTS = "grid grid-cols-2 gap-3";
export const AUTH_SEGMENT =
  "h-14 sm:h-14 w-full rounded-2xl border-2 font-story text-base font-bold transition-colors [&_svg]:size-5";
export const AUTH_SEGMENT_ON =
  "bg-aral-gold border-aral-navy text-aral-navy shadow-[0_3px_0_0_#12294D] hover:bg-aral-gold hover:text-aral-navy";
/** The picked intent on the teacher step-2 tabs: blue ink, gold stays reserved for the role pick and submit. */
export const AUTH_SEGMENT_ON_INK =
  "bg-aral-blue border-aral-navy text-aral-paper shadow-[0_3px_0_0_#12294D] hover:bg-aral-blue hover:text-aral-paper";
export const AUTH_SEGMENT_OFF =
  "bg-aral-paper border-aral-edge text-aral-navy/80 hover:bg-aral-sky hover:border-aral-blue/50";

/** Text links on the card. */
export const AUTH_LINK =
  "font-semibold text-aral-blue underline decoration-2 decoration-aral-blue/30 underline-offset-4 hover:decoration-aral-blue";

/** The quiet footer row under a step: recovery and the other sign-in. */
export const AUTH_FOOTER =
  "mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t-2 border-dashed border-aral-cloud pt-4 text-sm";

/** Pops a step's body in once, from an already-visible start. */
export const AUTH_STEP_TURN = "motion-safe:animate-story-pop";
