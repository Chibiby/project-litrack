"use client";

import * as React from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type SubmitHandler,
  type UseFormReturn,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodTypeAny } from "zod";
import { Form } from "@/components/ui/form";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import {
  setUnsavedChangesDirty,
  stableSerialize,
} from "@/hooks/unsaved-changes-context";
import { cn } from "@/lib/utils";

export type AppFormMode = "onBlur" | "onSubmit" | "onTouched" | "all";

export type UseAppFormOptions<TFieldValues extends FieldValues> = {
  schema: ZodTypeAny;
  defaultValues: DefaultValues<TFieldValues>;
  /** RHF validation mode. Default: onBlur (first), then onChange after error via reValidateMode. */
  mode?: AppFormMode;
  reValidateMode?: "onChange" | "onBlur" | "onSubmit";
};

/**
 * Shared RHF + Zod setup: validate on blur first; revalidate on change after first error.
 */
export function useAppForm<TFieldValues extends FieldValues>({
  schema,
  defaultValues,
  mode = "onBlur",
  reValidateMode = "onChange",
}: UseAppFormOptions<TFieldValues>): UseFormReturn<TFieldValues> {
  return useForm<TFieldValues>({
    // zodResolver typing is stricter than our ZodTypeAny usage across schemas
    resolver: zodResolver(schema) as Resolver<TFieldValues>,
    defaultValues,
    mode,
    reValidateMode,
  });
}

type AppFormProps<TFieldValues extends FieldValues> = {
  form: UseFormReturn<TFieldValues>;
  onSubmit: SubmitHandler<TFieldValues>;
  children: React.ReactNode;
  className?: string;
  id?: string;
  /**
   * Opt-in unsaved-changes guard (beforeunload + in-app link intercept).
   * Enable on long / multi-field forms only.
   */
  enableUnsavedGuard?: boolean;
  unsavedMessage?: string;
  /**
   * Show top error summary with jump links (long / multi-section forms).
   */
  showErrorSummary?: boolean;
  errorSummaryTitle?: string;
  /** Called after a failed validation submit (focus first invalid is handled). */
  onInvalid?: () => void;
};

/**
 * Dirty signal that does not rely solely on RHF `formState.isDirty` subscription.
 * Wizard steps mount/unmount fields; comparing watched values to RHF defaultValues
 * (updated on reset/markFormClean) is reliable for header Sign out confirms.
 */
function useReliableFormDirty<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  enabled: boolean
): boolean {
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setDirty(false);
      return;
    }

    const sync = () => {
      const defaults = form.control._defaultValues;
      const valuesDirty =
        stableSerialize(form.getValues()) !== stableSerialize(defaults);
      // Access isDirty so RHF enables dirty tracking; still OR with valuesDiff
      // because useFormState subscriptions alone can miss wizard field edits.
      const rhfDirty = form.formState.isDirty;
      setDirty(Boolean(rhfDirty || valuesDirty));
    };

    sync();

    // Public subscribe enables `_proxySubscribeFormState.isDirty` so RHF
    // actually updates isDirty on change.
    const unsubscribe = form.subscribe({
      formState: { isDirty: true, values: true },
      callback: sync,
    });
    const watchSub = form.watch(() => sync());

    return () => {
      unsubscribe();
      watchSub.unsubscribe();
    };
  }, [form, enabled]);

  return enabled ? dirty : false;
}

/**
 * Project form shell: FormProvider + submit wiring + optional error summary + unsaved guard.
 */
export function AppForm<TFieldValues extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
  id,
  enableUnsavedGuard = false,
  unsavedMessage,
  showErrorSummary = false,
  errorSummaryTitle,
  onInvalid,
}: AppFormProps<TFieldValues>) {
  const isDirty = useReliableFormDirty(form, enableUnsavedGuard);
  useUnsavedChangesGuard(isDirty, enableUnsavedGuard, unsavedMessage);

  const handleInvalid = React.useCallback(() => {
    const names = Object.keys(form.formState.errors);
    if (names.length > 0) {
      try {
        form.setFocus(names[0] as Path<TFieldValues>);
      } catch {
        /* field may be custom */
      }
      const el =
        document.getElementById(`${names[0]}-form-item`) ??
        document.querySelector(`[name="${names[0]}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    onInvalid?.();
  }, [form, onInvalid]);

  return (
    <Form {...form}>
      <form
        id={id}
        className={cn(className)}
        onSubmit={form.handleSubmit(onSubmit, handleInvalid)}
        noValidate
      >
        {showErrorSummary ? (
          <FormErrorSummary title={errorSummaryTitle} className="mb-4" />
        ) : null}
        {children}
      </form>
    </Form>
  );
}

/** Mark form clean after a successful save (resets dirty without changing values). */
export function markFormClean<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  values?: TFieldValues
) {
  form.reset(values ?? form.getValues());
  setUnsavedChangesDirty(false);
}
