"use client";

import { useFormContext, type FieldErrors, type FieldValues } from "react-hook-form";
import { AlertCircle } from "lucide-react";
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
};

/**
 * Top-of-form error summary with jump links. Use on long / multi-section forms.
 */
export function FormErrorSummary({
  className,
  title = "Please fix the following:",
  show = true,
}: FormErrorSummaryProps) {
  const {
    formState: { errors, isSubmitted, submitCount },
    setFocus,
  } = useFormContext();

  if (!show) return null;
  if (!isSubmitted && submitCount === 0) return null;

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
            {items.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  className="text-left text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    try {
                      setFocus(item.name as never);
                    } catch {
                      document.getElementById(`${item.name}`)?.focus();
                    }
                    const el =
                      document.getElementById(`${item.name}-form-item`) ??
                      document.querySelector(`[name="${item.name}"]`);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  {item.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
