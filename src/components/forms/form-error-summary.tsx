"use client";

import { useFormContext, type FieldErrors, type FieldValues } from "react-hook-form";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function flattenErrors(
  errors: FieldErrors<FieldValues>,
  prefix = ""
): { name: string; message: string }[] {
  const out: { name: string; message: string }[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (!value) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && "message" in value && value.message) {
      out.push({ name: path, message: String(value.message) });
    } else if (typeof value === "object" && value !== null) {
      out.push(...flattenErrors(value as FieldErrors<FieldValues>, path));
    }
  }
  return out;
}

type FormErrorSummaryProps = {
  className?: string;
  title?: string;
  /** When false, render nothing even if errors exist. */
  show?: boolean;
  /**
   * Field name → human label. Without it a list of three "Required" entries
   * tells the reader nothing about which three fields they are. Partial maps are
   * expected — an unlabelled field falls back to its message alone.
   */
  fieldLabels?: Record<string, string | undefined>;
  /** Field name → the section or step it lives in, so the reader knows where to look. */
  sectionOf?: (field: string) => string | undefined;
  /**
   * Called before focusing, for forms whose fields are not all mounted at once
   * (a wizard has to switch step first). Focus is deferred a frame when set.
   */
  onJump?: (field: string) => void;
  /**
   * Wait for RHF to record a submit before showing anything. Forms that drive
   * their own validation (setError outside handleSubmit) must pass false, or the
   * summary stays hidden however many errors are set.
   */
  waitForSubmit?: boolean;
};

/**
 * Top-of-form error summary with jump links. Use on long / multi-section forms.
 */
export function FormErrorSummary({
  className,
  title = "Please fix the following:",
  show = true,
  fieldLabels,
  sectionOf,
  onJump,
  waitForSubmit = true,
}: FormErrorSummaryProps) {
  const {
    formState: { errors, isSubmitted, submitCount },
    setFocus,
  } = useFormContext();

  if (!show) return null;
  if (waitForSubmit && !isSubmitted && submitCount === 0) return null;

  const items = flattenErrors(errors);
  if (items.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-destructive">{title}</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {items.map((item) => {
              const label = fieldLabels?.[item.name];
              const section = sectionOf?.(item.name);
              return (
                <li key={item.name}>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-left text-destructive"
                    onClick={() => {
                      const focusField = () => {
                        try {
                          setFocus(item.name as never);
                        } catch {
                          document.getElementById(`${item.name}`)?.focus();
                        }
                        const el =
                          document.getElementById(`${item.name}-form-item`) ??
                          document.querySelector(`[name="${item.name}"]`);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      };

                      if (onJump) {
                        onJump(item.name);
                        // The field may not be mounted until the jump renders.
                        requestAnimationFrame(focusField);
                      } else {
                        focusField();
                      }
                    }}
                  >
                    {label ? `${label} — ${item.message}` : item.message}
                  </Button>
                  {section ? (
                    <span className="ml-1 text-xs text-muted-foreground">({section})</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
