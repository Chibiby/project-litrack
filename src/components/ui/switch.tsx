"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An on/off switch.
 *
 * Built on a plain `<button role="switch">` rather than
 * `@radix-ui/react-switch`, which this project does not install: the whole
 * primitive is one button, one thumb and an `aria-checked`, and adding a
 * dependency for that would mean touching `.npmrc`'s legacy-peer-deps and the
 * `@types/react` overrides for no behaviour we would not have to write anyway.
 *
 * Living under `components/ui/` is what makes the raw `<button>` correct here —
 * that directory is the exemption in `tests/unit/shadcn-coverage.test.ts`,
 * because it holds the primitives the rest of the app is required to use
 * instead of raw elements.
 *
 * Controlled only: pass `checked` and `onCheckedChange`. Every consumer so far
 * writes through a server action and needs to roll the value back when that
 * fails, so an internal uncontrolled state would be a second source of truth.
 */
const Switch = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<"button">, "onChange" | "type"> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }
>(({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-primary" : "bg-muted-foreground/30",
      className
    )}
    {...props}
  >
    <span
      aria-hidden
      className={cn(
        "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
        checked ? "translate-x-[22px]" : "translate-x-0.5"
      )}
    />
  </button>
));
Switch.displayName = "Switch";

export { Switch };
