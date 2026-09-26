import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-card hover:bg-muted hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Every size carries a 44px floor below `lg` and its authored height from
      // `lg` up. A phone or tablet is touched, not clicked: 36px is under the
      // WCAG 2.5.5 target size and it shows — the ARAL toolbars were the
      // visible case, but the same 36px button is in every table row, dialog
      // and filter bar in the app. Tablets in portrait (744–1023px) still get
      // a fixed sidebar shell only from `lg` (1024px) up, so the touch floor
      // has to match that breakpoint, not `sm`. Putting the floor here rather
      // than per component keeps one rule in one place.
      //
      // `cn` merges className last, so a caller's own unprefixed `h-*` (e.g.
      // `h-8`) overrides both the floor and the `lg:` override, applying
      // across the whole 640–1023px tablet band, not just desktop. Callers
      // that need a shorter control on tablet must repeat the floor
      // themselves, e.g. `h-11 lg:h-8` — see the attendance cell trigger.
      size: {
        default: "h-11 px-4 py-2 lg:h-10",
        sm: "h-11 rounded-lg px-3 lg:h-9",
        lg: "h-11 rounded-lg px-8",
        icon: "size-11 lg:size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Shows an inline spinner and disables the button, so a click that kicked off
   * a server action reads as "working" instead of "ignored". Ignored when
   * `asChild` is set — a link navigation has nothing to spin for, and injecting
   * a second child would break Slot's single-child contract.
   */
  loading?: boolean;
  /**
   * Label to show in place of `children` while loading — present progressive,
   * e.g. "Saving…". On `size="icon"` buttons it becomes the accessible name
   * instead, since there is no room for text.
   */
  loadingText?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const showSpinner = loading && !asChild;
    const iconOnly = size === "icon";

    // When not spinning, `children` passes through untouched — Slot still sees
    // exactly one child, so every existing `<Button asChild>` is unaffected.
    const content = !showSpinner ? (
      children
    ) : iconOnly ? (
      <Loader2 className="animate-spin" aria-hidden />
    ) : (
      <>
        <Loader2 className="animate-spin" aria-hidden />
        {loadingText ?? children}
      </>
    );

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={asChild ? disabled : disabled || loading}
        {...(showSpinner ? { "aria-busy": true } : null)}
        {...(showSpinner && iconOnly && loadingText
          ? { "aria-label": loadingText }
          : null)}
      >
        {content}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
