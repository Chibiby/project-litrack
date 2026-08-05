"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Shared sub-fields used by both School Head and Teacher profile forms
 * (Sections II — Professional Background, IV — Training & Development).
 */

export function FieldRadioGroup({
  name,
  options,
  defaultValue,
  required = true,
  "aria-labelledby": ariaLabelledBy,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
  "aria-labelledby"?: string;
}) {
  return (
    <div className="space-y-2" role="radiogroup" aria-labelledby={ariaLabelledBy}>
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            name={name}
            value={opt.value}
            defaultChecked={defaultValue === opt.value}
            required={required}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm leading-tight">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export function FieldCheckboxList({
  name,
  options,
  defaultValues = [],
  "aria-labelledby": ariaLabelledBy,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValues?: string[];
  "aria-labelledby"?: string;
}) {
  return (
    <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name={`${name}[]`}
            value={opt.value}
            defaultChecked={defaultValues.includes(opt.value)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm leading-tight">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export function FieldText({
  name,
  label,
  defaultValue,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}{required && " *"}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} required={required} type={type} />
    </div>
  );
}

export function FieldBoolean({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <Checkbox name={name} defaultChecked={defaultChecked} />
      <span className="text-sm">{label}</span>
    </label>
  );
}
