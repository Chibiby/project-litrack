"use client";

import { useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  School,
  Smartphone,
  Sparkles,
  UserCog,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  ReleaseGuideStep,
  ReleaseHighlight,
  ReleaseHighlightIcon,
  ReleaseHighlightTone,
} from "@/lib/releases";

const ICONS: Record<ReleaseHighlightIcon, LucideIcon> = {
  profiling: Users,
  reports: FileText,
  analytics: BarChart3,
  mobile: Smartphone,
  speed: Zap,
  workflow: Workflow,
  dashboard: LayoutDashboard,
  learners: Users,
  aral: BookOpenCheck,
  teachers: UserCog,
  checklist: ListChecks,
  schools: School,
  help: LifeBuoy,
};

/** Card wash and icon chip per tone — the dashboard stat-card families. */
const TONES: Record<ReleaseHighlightTone, { card: string; chip: string }> = {
  violet: {
    card: "bg-violet-50/80 dark:bg-violet-950/30",
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  },
  emerald: {
    card: "bg-emerald-50/80 dark:bg-emerald-950/30",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  },
  blue: {
    card: "bg-blue-50/80 dark:bg-blue-950/30",
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
  },
  amber: {
    card: "bg-amber-50/80 dark:bg-amber-950/30",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  },
  rose: {
    card: "bg-rose-50/80 dark:bg-rose-950/30",
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200",
  },
  purple: {
    card: "bg-purple-50/80 dark:bg-purple-950/30",
    chip: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200",
  },
};

const VIOLET_BUTTON = "bg-violet text-violet-foreground hover:bg-violet/90";

/**
 * The one-time LitRack v2 welcome, rendered inside the release modal's
 * `DialogContent`. Two views: the welcome itself, and a short tour behind
 * "Let's Get Started". Read-only — the only write is the acknowledgement the
 * caller runs from `onDismiss` / `onComplete`.
 */
export function ReleaseWelcome({
  version,
  headline,
  intro,
  highlightsTitle,
  highlightsSubtitle,
  highlights,
  guide,
  dontShowAgain,
  onDontShowAgainChange,
  error,
  saving,
  onDismiss,
  onComplete,
}: {
  version: string;
  headline: string;
  intro: string;
  highlightsTitle: string;
  highlightsSubtitle: string;
  highlights: ReleaseHighlight[];
  guide: ReleaseGuideStep[];
  dontShowAgain: boolean;
  onDontShowAgainChange: (next: boolean) => void;
  error: string | null;
  saving: boolean;
  /** "Explore Later", ✕, Escape: acknowledges only when "Don't show this again" is on. */
  onDismiss: () => void;
  /** Finishing or skipping the tour: always acknowledges. */
  onComplete: () => void;
}) {
  const [step, setStep] = useState<number | null>(null);
  const checkboxId = useId();
  const shortVersion = version.replace(/\.0$/, "");

  return (
    <div className="flex max-h-[92dvh] min-h-0 flex-col">
      <WelcomeBanner
        shortVersion={shortVersion}
        headline={headline}
        intro={intro}
        compact={step !== null}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
        {step === null ? (
          <section
            aria-labelledby={`${checkboxId}-new`}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <h3 id={`${checkboxId}-new`} className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
                  {highlightsTitle}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{highlightsSubtitle}</p>
              </div>
              <Link
                href="/releases"
                onClick={onDismiss}
                className="inline-flex items-center gap-1 text-sm font-semibold text-violet hover:underline sm:mt-2"
              >
                View Changelog
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
              {highlights.map((h) => (
                <li key={h.title} className={cn("flex gap-3 rounded-xl p-4", TONES[h.tone].card)}>
                  <ToneChip icon={h.icon} tone={h.tone} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground sm:text-[15px]">{h.title}</p>
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">{h.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <GuideStep steps={guide} index={step} />
        )}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {step === null ? (
        <footer className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <label htmlFor={checkboxId} className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
            <Checkbox
              id={checkboxId}
              checked={dontShowAgain}
              onCheckedChange={(v) => onDontShowAgainChange(v === true)}
              className="data-[state=checked]:border-violet data-[state=checked]:bg-violet data-[state=checked]:text-violet-foreground"
            />
            Don&apos;t show this again
          </label>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <Button variant="outline" onClick={onDismiss} disabled={saving} className="sm:min-w-36">
              Explore Later
            </Button>
            <Button
              onClick={() => setStep(0)}
              disabled={saving || guide.length === 0}
              className={cn(VIOLET_BUTTON, "sm:min-w-44")}
            >
              Let&apos;s Get Started
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      ) : (
        <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
          <Button variant="ghost" onClick={onComplete} disabled={saving} className="text-muted-foreground">
            Skip tour
          </Button>
          <div className="flex gap-2 sm:gap-3">
            <Button variant="outline" onClick={() => setStep(step === 0 ? null : step - 1)} disabled={saving}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            {step < guide.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} className={VIOLET_BUTTON}>
                Next
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button onClick={onComplete} loading={saving} loadingText="Saving…" className={VIOLET_BUTTON}>
                Finish
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function WelcomeBanner({
  shortVersion,
  headline,
  intro,
  compact,
}: {
  shortVersion: string;
  headline: string;
  intro: string;
  compact: boolean;
}) {
  return (
    <header
      className={cn(
        "relative isolate overflow-hidden bg-gradient-to-br from-violet-soft via-background to-violet-soft/60 px-4 sm:px-8",
        compact ? "pb-4 pt-5" : "pb-5 pt-6 sm:pb-7 sm:pt-8 [@media(max-height:800px)]:sm:pb-5 [@media(max-height:800px)]:sm:pt-6"
      )}
    >
      {/* The v2 learner art, right- and bottom-anchored; faded under the text
          wherever the two would meet. */}
      <Image
        src="/brand/banner-learner.png"
        alt=""
        aria-hidden="true"
        width={2172}
        height={579}
        priority
        className={cn(
          "pointer-events-none absolute bottom-0 right-0 -z-10 h-full w-auto max-w-none object-cover object-right [mask-image:linear-gradient(to_right,transparent,black_30%)]",
          compact ? "opacity-40 sm:opacity-70" : "opacity-30 sm:opacity-60 lg:opacity-100"
        )}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-background/95 via-background/60 to-transparent lg:via-background/40"
      />

      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="ARAL Program logo" width={36} height={48} className="h-11 w-auto shrink-0 sm:h-14" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl font-extrabold tracking-tight text-violet sm:text-2xl">LITRACK</span>
            <span className="rounded-full bg-violet px-2.5 py-0.5 text-xs font-semibold text-violet-foreground sm:text-sm">
              v{shortVersion}
            </span>
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">Learner Profiling &amp; ARAL</p>
        </div>
      </div>

      {compact ? (
        <>
          <DialogTitle className="mt-3 flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
            <Sparkles className="h-5 w-5 text-violet" aria-hidden="true" />
            Quick tour
          </DialogTitle>
          <DialogDescription className="sr-only">A few steps to find your way around Litrack v2.</DialogDescription>
        </>
      ) : (
        <>
          <DialogTitle className="mt-4 max-w-[34rem] text-3xl font-extrabold tracking-tight text-foreground sm:mt-6 sm:text-4xl lg:text-[2.75rem] lg:leading-tight [@media(max-height:800px)]:sm:mt-4 [@media(max-height:800px)]:lg:text-4xl">
            {headline}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-[28rem] text-sm leading-relaxed text-muted-foreground sm:mt-3 sm:text-base lg:text-lg">
            {intro}
          </DialogDescription>
        </>
      )}
    </header>
  );
}

function GuideStep({ steps, index }: { steps: ReleaseGuideStep[]; index: number }) {
  const current = steps[index];
  if (!current) return null;
  return (
    <section aria-live="polite" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Step {index + 1} of {steps.length}
      </p>
      <div className={cn("mt-4 flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6", TONES[current.tone].card)}>
        <ToneChip icon={current.icon} tone={current.tone} large />
        <div className="min-w-0">
          <h3 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">{current.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">{current.body}</p>
        </div>
      </div>
      <ol className="mt-5 flex justify-center gap-1.5" aria-label="Tour progress">
        {steps.map((s, i) => (
          <li
            key={s.title + i}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-6 bg-violet" : "w-1.5 bg-border"
            )}
          >
            <span className="sr-only">
              Step {i + 1}: {s.title}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ToneChip({
  icon,
  tone,
  large = false,
}: {
  icon: ReleaseHighlightIcon;
  tone: ReleaseHighlightTone;
  large?: boolean;
}) {
  const Icon = ICONS[icon] ?? ClipboardCheck;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl",
        large ? "h-14 w-14" : "h-10 w-10 sm:h-11 sm:w-11",
        TONES[tone].chip
      )}
    >
      <Icon className={large ? "h-7 w-7" : "h-5 w-5"} aria-hidden="true" />
    </span>
  );
}
