"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type WizardStepDef = {
  id: string;
  /** Short label for stepper (e.g. "Respondent") */
  shortLabel: string;
  /** Full section title shown in card */
  title: string;
};

type ProfileWizardChromeProps = {
  steps: WizardStepDef[];
  /** 0-based step index */
  currentStep: number;
  children: React.ReactNode;
  pending?: boolean;
  onBack: () => void;
  onContinue: () => void;
  /** When on last (review) step, primary action is Save */
  continueLabel?: string;
};

/**
 * Shared profiling wizard chrome: step text, progress bar, responsive step rail,
 * Back / Continue|Save. Leave/exit is via header Sign out (unsaved-changes guard).
 */
export function ProfileWizardChrome({
  steps,
  currentStep,
  children,
  pending,
  onBack,
  onContinue,
  continueLabel,
}: ProfileWizardChromeProps) {
  const total = steps.length;
  const stepNumber = currentStep + 1;
  const progressPct = Math.round((stepNumber / total) * 100);
  const isFirst = currentStep === 0;
  const isLast = currentStep === total - 1;
  const primaryLabel =
    continueLabel ?? (isLast ? "Save profile" : "Continue");
  const primaryLoadingText = isLast ? "Saving…" : "Continuing…";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-foreground">
            Step {stepNumber} of {total}
            <span className="ml-2 font-normal text-muted-foreground">
              {steps[currentStep]?.title}
            </span>
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{progressPct}%</p>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Profile progress, step ${stepNumber} of ${total}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <ol className="hidden gap-1 sm:flex" aria-label="Profiling steps">
          {steps.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <li key={step.id} className="min-w-0 flex-1">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs",
                    active && "border-primary bg-primary/10 text-primary",
                    done && !active && "border-border bg-muted/40 text-foreground",
                    !done && !active && "border-transparent text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      active && "bg-primary text-primary-foreground",
                      done && !active && "bg-primary/20 text-primary",
                      !done && !active && "bg-muted text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate font-medium">{step.shortLabel}</span>
                </div>
              </li>
            );
          })}
        </ol>
        <ol className="flex justify-center gap-2 sm:hidden" aria-label="Profiling steps">
          {steps.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <li key={step.id}>
                <span
                  className={cn(
                    "block h-2.5 w-2.5 rounded-full",
                    active && "bg-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-background",
                    done && !active && "bg-primary/50",
                    !done && !active && "bg-muted-foreground/30"
                  )}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${step.title}${active ? ", current" : done ? ", completed" : ""}`}
                />
              </li>
            );
          })}
        </ol>
      </div>

      {children}

      <div className="flex flex-wrap items-center gap-2">
        {!isFirst ? (
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            Back
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={onContinue}
          loading={pending}
          loadingText={primaryLoadingText}
          className="min-w-[7.5rem]"
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
