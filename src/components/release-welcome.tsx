"use client";

import { useEffect, useId, useState } from "react";
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
  LocalizedText,
  ReleaseGuideStep,
  ReleaseHighlight,
  ReleaseHighlightIcon,
  ReleaseHighlightTone,
  WelcomeLocale,
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

type UiCopy = {
  viewChangelog: string;
  dontShowAgain: string;
  exploreLater: string;
  getStarted: string;
  quickTour: string;
  quickTourDescription: string;
  step: (n: number, total: number) => string;
  back: string;
  next: string;
  finish: string;
  saving: string;
  skipTour: string;
  showMe: string;
  tourProgress: string;
  language: string;
};

/** The modal's own labels. The release copy itself lives in `RELEASES`. */
const UI: Record<WelcomeLocale, UiCopy> = {
  en: {
    viewChangelog: "View Changelog",
    dontShowAgain: "Don't show this again",
    exploreLater: "Explore Later",
    getStarted: "Let's Get Started",
    quickTour: "Quick tour",
    quickTourDescription: "A few steps to find your way around Litrack v2.",
    step: (n, total) => `Step ${n} of ${total}`,
    back: "Back",
    next: "Next",
    finish: "Finish",
    saving: "Saving…",
    skipTour: "Skip tour",
    showMe: "Show me",
    tourProgress: "Tour progress",
    language: "Language",
  },
  fil: {
    viewChangelog: "Tingnan ang Changelog",
    dontShowAgain: "Huwag ipakita muli",
    exploreLater: "Tuklasin Mamaya",
    getStarted: "Magsimula",
    quickTour: "Maikling gabay",
    quickTourDescription: "Ilang hakbang upang makilala ang Litrack v2.",
    step: (n, total) => `Hakbang ${n} ng ${total}`,
    back: "Bumalik",
    next: "Susunod",
    finish: "Tapos",
    saving: "Sine-save…",
    skipTour: "Laktawan",
    showMe: "Ipakita",
    tourProgress: "Progreso ng gabay",
    language: "Wika",
  },
};

const LOCALE_KEY = "litrack:welcome-locale";

/** Remembered per browser as a convenience; any storage failure means English. */
function useWelcomeLocale(): [WelcomeLocale, (next: WelcomeLocale) => void] {
  const [locale, setLocale] = useState<WelcomeLocale>("en");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LOCALE_KEY) === "fil") setLocale("fil");
    } catch {
      // Storage blocked: stay on English.
    }
  }, []);
  const choose = (next: WelcomeLocale) => {
    setLocale(next);
    try {
      window.localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the modal closes.
    }
  };
  return [locale, choose];
}

/**
 * The one-time LitRack v2 welcome, rendered inside the release modal's
 * `DialogContent`. Two views — the welcome itself, and a short tour behind
 * "Let's Get Started" — each readable in English or Filipino. Read-only: the
 * only write is the acknowledgement the caller runs from `onDismiss` /
 * `onComplete`.
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
  headline: LocalizedText;
  intro: LocalizedText;
  highlightsTitle: LocalizedText;
  highlightsSubtitle: LocalizedText;
  highlights: ReleaseHighlight[];
  guide: ReleaseGuideStep[];
  dontShowAgain: boolean;
  onDontShowAgainChange: (next: boolean) => void;
  error: string | null;
  saving: boolean;
  /** "Explore Later", ✕, Escape: acknowledges only when "Don't show this again" is on. */
  onDismiss: () => void;
  /** Finishing, skipping, or leaving the tour for a page: always acknowledges. */
  onComplete: () => void;
}) {
  const [step, setStep] = useState<number | null>(null);
  const [locale, setLocale] = useWelcomeLocale();
  const ui = UI[locale];
  const baseId = useId();
  const shortVersion = version.replace(/\.0$/, "");
  const languageSwitch = <LanguageSwitch locale={locale} onChange={setLocale} label={ui.language} />;

  return (
    <div lang={locale} className="flex max-h-[92dvh] min-h-0 flex-col">
      <WelcomeBanner
        shortVersion={shortVersion}
        headline={headline[locale]}
        intro={intro[locale]}
        compact={step !== null}
        ui={ui}
        languageSwitch={languageSwitch}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
        {step === null ? (
          <section
            aria-labelledby={`${baseId}-new`}
            className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <h3 id={`${baseId}-new`} className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
                  {highlightsTitle[locale]}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{highlightsSubtitle[locale]}</p>
              </div>
              <Link
                href="/releases"
                onClick={onDismiss}
                className="inline-flex items-center gap-1 text-sm font-semibold text-violet hover:underline sm:mt-2"
              >
                {ui.viewChangelog}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
              {highlights.map((h) => (
                <li key={h.title.en} className={cn("flex gap-3 rounded-xl p-4", TONES[h.tone].card)}>
                  <ToneChip icon={h.icon} tone={h.tone} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground sm:text-[15px]">{h.title[locale]}</p>
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">{h.body[locale]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <GuideStep steps={guide} index={step} locale={locale} ui={ui} onShowMe={onComplete} />
        )}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {step === null ? (
        <footer className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <label htmlFor={`${baseId}-dont`} className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
            <Checkbox
              id={`${baseId}-dont`}
              checked={dontShowAgain}
              onCheckedChange={(v) => onDontShowAgainChange(v === true)}
              className="data-[state=checked]:border-violet data-[state=checked]:bg-violet data-[state=checked]:text-violet-foreground"
            />
            {ui.dontShowAgain}
          </label>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <Button variant="outline" onClick={onDismiss} disabled={saving} className="sm:min-w-36">
              {ui.exploreLater}
            </Button>
            <Button
              onClick={() => setStep(0)}
              disabled={saving || guide.length === 0}
              className={cn(VIOLET_BUTTON, "sm:min-w-44")}
            >
              {ui.getStarted}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      ) : (
        <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-4 sm:px-6">
          <Button variant="ghost" onClick={onComplete} disabled={saving} className="px-2 text-muted-foreground sm:px-4">
            {ui.skipTour}
          </Button>
          <div className="flex gap-2 sm:gap-3">
            <Button variant="outline" onClick={() => setStep(step === 0 ? null : step - 1)} disabled={saving}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {ui.back}
            </Button>
            {step < guide.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} className={VIOLET_BUTTON}>
                {ui.next}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button onClick={onComplete} loading={saving} loadingText={ui.saving} className={VIOLET_BUTTON}>
                {ui.finish}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function LanguageSwitch({
  locale,
  onChange,
  label,
}: {
  locale: WelcomeLocale;
  onChange: (next: WelcomeLocale) => void;
  label: string;
}) {
  const options: { value: WelcomeLocale; text: string }[] = [
    { value: "en", text: "English" },
    { value: "fil", text: "Filipino" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-full border border-border bg-card/90 p-0.5 text-xs font-semibold shadow-sm backdrop-blur"
    >
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          variant="ghost"
          role="radio"
          aria-checked={locale === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-auto min-h-8 rounded-full px-3",
            locale === o.value
              ? "bg-violet text-violet-foreground hover:bg-violet hover:text-violet-foreground"
              : "text-muted-foreground hover:bg-transparent hover:text-foreground"
          )}
        >
          {o.text}
        </Button>
      ))}
    </div>
  );
}

function WelcomeBanner({
  shortVersion,
  headline,
  intro,
  compact,
  ui,
  languageSwitch,
}: {
  shortVersion: string;
  headline: string;
  intro: string;
  compact: boolean;
  ui: UiCopy;
  languageSwitch: React.ReactNode;
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
          "pointer-events-none absolute bottom-0 right-0 -z-10 h-full w-auto max-w-none object-cover object-right [mask-image:linear-gradient(to_right,transparent_40%,black_56%)]",
          compact ? "opacity-40 sm:opacity-70" : "opacity-30 sm:opacity-60 lg:opacity-100"
        )}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-background/95 via-background/60 to-transparent lg:via-background/40"
      />

      {/* Beside the close button from sm up; under the intro on phones. */}
      <div className="absolute right-16 top-5 hidden sm:block">{languageSwitch}</div>

      <div className="flex items-center gap-3 pr-12 sm:pr-0">
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
            {ui.quickTour}
          </DialogTitle>
          <DialogDescription className="sr-only">{ui.quickTourDescription}</DialogDescription>
        </>
      ) : (
        <>
          <DialogTitle className="mt-4 max-w-[34rem] text-3xl lg:max-w-[27rem] font-extrabold tracking-tight text-foreground sm:mt-6 sm:text-4xl lg:text-[2.75rem] lg:leading-tight [@media(max-height:800px)]:sm:mt-4 [@media(max-height:800px)]:lg:text-4xl">
            {headline}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-[28rem] text-sm lg:max-w-[25rem] leading-relaxed text-muted-foreground sm:mt-3 sm:text-base">
            {intro}
          </DialogDescription>
        </>
      )}

      <div className="mt-3 sm:hidden">{languageSwitch}</div>
    </header>
  );
}

function GuideStep({
  steps,
  index,
  locale,
  ui,
  onShowMe,
}: {
  steps: ReleaseGuideStep[];
  index: number;
  locale: WelcomeLocale;
  ui: UiCopy;
  /** Leaving for a page ends the tour, so it acknowledges like Finish. */
  onShowMe: () => void;
}) {
  const current = steps[index];
  if (!current) return null;
  return (
    <section aria-live="polite" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {ui.step(index + 1, steps.length)}
      </p>
      <div className={cn("mt-4 flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-start sm:gap-5 sm:p-6", TONES[current.tone].card)}>
        <ToneChip icon={current.icon} tone={current.tone} large />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">{current.title[locale]}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">{current.body[locale]}</p>
          {current.href ? (
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href={current.href} onClick={onShowMe}>
                {ui.showMe}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <ol className="mt-5 flex justify-center gap-1.5" aria-label={ui.tourProgress}>
        {steps.map((s, i) => (
          <li
            key={`${s.title.en}-${i}`}
            aria-current={i === index ? "step" : undefined}
            className={cn("h-1.5 rounded-full transition-all", i === index ? "w-6 bg-violet" : "w-1.5 bg-border")}
          >
            <span className="sr-only">
              {ui.step(i + 1, steps.length)}: {s.title[locale]}
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
