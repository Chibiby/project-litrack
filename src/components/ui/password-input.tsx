"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** "lg" widens the show/hide toggle and its icon for tall, roomy fields. */
  toggleSize?: "default" | "lg";
};

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, disabled, toggleSize = "default", ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  const large = toggleSize === "lg";

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={cn(large ? "pr-14" : "pr-10", "[&::-ms-reveal]:hidden", className)}
        disabled={disabled}
        ref={ref}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tabIndex={0}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        // lg:h-full / lg:w-10 beat the icon size's lg:size-10, so the toggle
        // spans the field's full height (and stays centred) on tall inputs too.
        className={cn(
          "absolute inset-y-0 right-0 h-full text-muted-foreground hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed",
          large ? "w-14 px-4 lg:h-full lg:w-14 [&_svg]:size-5" : "w-10 px-3 lg:h-full lg:w-10",
        )}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
