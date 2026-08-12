"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

type Option = { value: string; label: string; disabled?: boolean };

/** Segmented / pill single-select (login-form pattern). */
export function FormOptionPills<T extends FieldValues>({
  control,
  name,
  label,
  options,
  required,
  description,
  columns,
  onValueChange,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: Option[];
  required?: boolean;
  description?: string;
  /** Tailwind grid cols class fragment, default auto-fit */
  columns?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required}>{label}</FormLabel>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormControl>
            <div
              role="radiogroup"
              aria-label={label}
              className={cn(
                "flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/40 p-1.5",
                columns
              )}
            >
              {options.map((opt) => {
                const selected = field.value === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "ghost"}
                    className="min-h-9 flex-1 basis-[calc(50%-0.25rem)] sm:basis-auto"
                    aria-pressed={selected}
                    onClick={() => {
                      field.onChange(opt.value);
                      onValueChange?.(opt.value);
                    }}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Yes / No pill pair bound to boolean (or undefined until chosen). */
export function FormYesNoPills<T extends FieldValues>({
  control,
  name,
  label,
  required,
  onValueChange,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  required?: boolean;
  onValueChange?: (value: boolean) => void;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const selected =
          field.value === true ? "true" : field.value === false ? "false" : "";
        return (
          <FormItem>
            <FormLabel required={required}>{label}</FormLabel>
            <FormControl>
              <div
                role="radiogroup"
                aria-label={label}
                className="grid max-w-xs grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
              >
                {(
                  [
                    { value: "true", label: "Yes", bool: true },
                    { value: "false", label: "No", bool: false },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={selected === opt.value ? "default" : "ghost"}
                    className="w-full"
                    aria-pressed={selected === opt.value}
                    onClick={() => {
                      field.onChange(opt.bool);
                      onValueChange?.(opt.bool);
                    }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/** Multi-select checkboxes with optional NONE exclusivity. */
export function FormCheckboxChips<T extends FieldValues>({
  control,
  name,
  label,
  options,
  required,
  description,
  noneValue = "NONE",
  selectAll,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: Option[];
  required?: boolean;
  description?: string;
  noneValue?: string;
  /** Show Select all / Clear all controls above the checklist. */
  selectAll?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const values: string[] = Array.isArray(field.value) ? field.value : [];
        const selectableValues = options
          .map((o) => o.value)
          .filter((v) => v !== noneValue);
        const toggle = (value: string, checked: boolean) => {
          let next: string[];
          if (value === noneValue) {
            next = checked ? [noneValue] : [];
          } else if (checked) {
            next = [...values.filter((v) => v !== noneValue), value];
          } else {
            next = values.filter((v) => v !== value);
          }
          field.onChange(next);
        };
        return (
          <FormItem>
            <FormLabel required={required}>{label}</FormLabel>
            {description ? <FormDescription>{description}</FormDescription> : null}
            {selectAll ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    selectableValues.length === 0 ||
                    selectableValues.every((v) => values.includes(v))
                  }
                  onClick={() => field.onChange(selectableValues)}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={values.length === 0}
                  onClick={() => field.onChange([])}
                >
                  Clear all
                </Button>
                <span className="text-xs text-muted-foreground">
                  {values.length} of {selectableValues.length} selected
                </span>
              </div>
            ) : null}
            <div className="space-y-2">
              {options.map((opt) => {
                const checked = values.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-1 py-1 hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggle(opt.value, v === true)}
                      aria-label={opt.label}
                    />
                    <span className="text-sm leading-tight">{opt.label}</span>
                  </label>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

export function FormTextField<T extends FieldValues>({
  control,
  name,
  label,
  required,
  description,
  type = "text",
  autoComplete,
  inputMode,
  placeholder,
  min,
  max,
  step,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  required?: boolean;
  description?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required}>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ""}
              type={type}
              autoComplete={autoComplete}
              inputMode={inputMode}
              placeholder={placeholder}
              min={min}
              max={max}
              step={step}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function FormSelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  required,
  description,
  placeholder = "Select…",
  allowEmpty,
  emptyLabel = "None",
  onValueChange,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: Option[];
  required?: boolean;
  description?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required}>{label}</FormLabel>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <Select
            value={field.value ? String(field.value) : undefined}
            onValueChange={(v) => {
              const next = v === "__empty__" ? undefined : v;
              field.onChange(next);
              onValueChange?.(v === "__empty__" ? "" : v);
            }}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {allowEmpty ? (
                <SelectItem value="__empty__">{emptyLabel}</SelectItem>
              ) : null}
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Input value={value} readOnly disabled className="bg-muted" />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
