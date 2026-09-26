"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SearchInputFocusShortcut = {
  /** e.g. "k" for Ctrl/⌘+K. Matched case-insensitively. */
  key: string;
  /** Require Ctrl (Windows/Linux) or ⌘ (Mac) held down. */
  metaOrCtrl?: boolean;
};

export interface SearchInputProps {
  value?: string;
  onValueChange?: (value: string) => void;
  /** Uncontrolled mode: renders a plain `name`d input seeded with `defaultValue`. */
  name?: string;
  defaultValue?: string;
  /** Accessible name. Rendered as a visible `<Label>` only when `labelVisible`. */
  label: string;
  labelVisible?: boolean;
  placeholder?: string;
  onDebouncedChange?: (value: string) => void;
  debounceMs?: number;
  onSubmit?: () => void;
  onClear?: () => void;
  resultCount?: number;
  resultCountLabel?: (count: number) => string;
  /** Opt-in window-level Ctrl/⌘+key listener that focuses and selects this field. */
  focusShortcut?: SearchInputFocusShortcut;
  disableBrowserAutocomplete?: boolean;
  /**
   * Escape on a non-empty field clears it (default). Pass false inside a
   * popover or dropdown, where Escape must close the list instead and the
   * caller's own onKeyDown handles it.
   */
  escapeClears?: boolean;
  disabled?: boolean;
  /** Focus the field as soon as it mounts — e.g. a combobox's search field inside a just-opened popover. */
  autoFocus?: boolean;
  /** Wrapper classes — use this for width. */
  className?: string;
  inputClassName?: string;
  id?: string;
  role?: "searchbox" | "combobox";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-autocomplete"?: React.AriaAttributes["aria-autocomplete"];
  "aria-activedescendant"?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function defaultResultCountLabel(count: number): string {
  return `${count} ${count === 1 ? "result" : "results"}`;
}

/** The leading glyph other search-styled fields (comboboxes) can reuse to match spacing. */
export function SearchFieldIcon({ className }: { className?: string }) {
  return (
    <Search
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
        className
      )}
    />
  );
}

/** The trailing clear (×) button other search-styled fields can reuse to match spacing and behaviour. */
export function SearchClearButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Clear ${label}`}
      onClick={onClick}
      className={cn("absolute right-1 top-1/2 size-9 -translate-y-1/2 lg:size-8", className)}
    >
      <X aria-hidden className="size-4" />
    </Button>
  );
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onValueChange,
      name,
      defaultValue,
      label,
      labelVisible = false,
      placeholder,
      onDebouncedChange,
      debounceMs = 500,
      onSubmit,
      onClear,
      resultCount,
      resultCountLabel,
      focusShortcut,
      disableBrowserAutocomplete,
      escapeClears = true,
      disabled,
      autoFocus,
      className,
      inputClassName,
      id,
      role = "searchbox",
      "aria-expanded": ariaExpanded,
      "aria-controls": ariaControls,
      "aria-autocomplete": ariaAutocomplete,
      "aria-activedescendant": ariaActivedescendant,
      onKeyDown: onKeyDownProp,
      onFocus,
      onBlur,
    },
    forwardedRef
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
    const current = isControlled ? value : internalValue;

    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
      },
      [forwardedRef]
    );

    function setValue(next: string) {
      if (!isControlled) setInternalValue(next);
      onValueChange?.(next);
    }

    const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFired = React.useRef(current);

    React.useEffect(() => {
      if (!onDebouncedChange) return;
      if (current === lastFired.current) return;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        lastFired.current = current;
        onDebouncedChange(current);
      }, debounceMs);
      return () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current, debounceMs]);

    function flushDebounced(next: string) {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      lastFired.current = next;
      onDebouncedChange?.(next);
    }

    function handleClear() {
      setValue("");
      onClear?.();
      flushDebounced("");
      inputRef.current?.focus();
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
      if (event.key === "Escape") {
        if (current && escapeClears) {
          handleClear();
          event.preventDefault();
          return;
        }
        // Empty field: nothing here to clear, so the event is left alone —
        // a caller's own onKeyDown (e.g. header-search closing its dropdown)
        // still gets it.
      } else if (event.key === "Enter") {
        flushDebounced(current);
        // Only swallow the key when a form submit isn't the intended target:
        // schools-table/accounts-table submit their filter forms natively on
        // Enter, and preventing default there would silently break that.
        const insideForm = event.currentTarget.form !== null;
        if ((onSubmit || onDebouncedChange) && !insideForm) {
          event.preventDefault();
        }
        onSubmit?.();
      }
      onKeyDownProp?.(event);
    }

    React.useEffect(() => {
      if (!focusShortcut) return;
      function onWindowKeyDown(event: KeyboardEvent) {
        // A window "keydown" listener receives anything dispatched under that
        // type, including a bare `new Event("keydown")` with no `key` at all.
        if (typeof event.key !== "string") return;
        if (event.key.toLowerCase() !== focusShortcut!.key.toLowerCase()) return;
        if (focusShortcut!.metaOrCtrl && !event.metaKey && !event.ctrlKey) return;
        // A bare-key shortcut must not steal keystrokes typed into another
        // field; a Ctrl/⌘ combo types nothing, so it works from anywhere.
        if (!focusShortcut!.metaOrCtrl && isEditableTarget(event.target)) return;
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      window.addEventListener("keydown", onWindowKeyDown);
      return () => window.removeEventListener("keydown", onWindowKeyDown);
    }, [focusShortcut]);

    const inputProps: React.InputHTMLAttributes<HTMLInputElement> = {
      id: inputId,
      name,
      type: "search",
      inputMode: "search",
      enterKeyHint: "search",
      placeholder,
      disabled,
      autoFocus,
      role,
      "aria-expanded": ariaExpanded,
      "aria-controls": ariaControls,
      "aria-autocomplete": ariaAutocomplete,
      "aria-activedescendant": ariaActivedescendant,
      onFocus,
      onBlur,
      onKeyDown: handleKeyDown,
      onChange: (event) => setValue(event.target.value),
    };

    if (disableBrowserAutocomplete) {
      inputProps.autoComplete = "off";
      inputProps.spellCheck = false;
      inputProps.autoCapitalize = "off";
    }

    // Always controlled underneath: in uncontrolled mode the internal state
    // drives the DOM, so the clear button and Escape actually empty the field.
    inputProps.value = current;

    return (
      <div className={cn("relative", className)}>
        <SearchFieldIcon />
        <Label htmlFor={inputId} className={labelVisible ? undefined : "sr-only"}>
          {label}
        </Label>
        <Input
          {...inputProps}
          ref={setRefs}
          className={cn("h-11 pl-9 pr-10 lg:h-10", inputClassName)}
        />
        {current && <SearchClearButton label="search" onClick={handleClear} />}
        {resultCount !== undefined && (
          <span role="status" aria-live="polite" className="sr-only">
            {(resultCountLabel ?? defaultResultCountLabel)(resultCount)}
          </span>
        )}
      </div>
    );
  }
);
