"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ERROR_LOG_WINDOWS } from "@/lib/admin/error-log";

const ANY = "any";

/**
 * Writes the same query shape `parseErrorLogParams` reads, so the `?ref=` link
 * in an alert email lands on exactly this view.
 */
export function ErrorLogFilters({
  refFilter: initialRef,
  code,
  severity,
  window: initialWindow,
}: {
  refFilter: string | null;
  code: string | null;
  severity: string | null;
  window: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [refValue, setRefValue] = useState(initialRef ?? "");

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === ANY) next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => router.push(`/admin/errors?${next.toString()}`));
  };

  const [pushedRef, setPushedRef] = useState<string | null>(initialRef);
  const searchNow = (value: string) => {
    const term = value.trim() || null;
    if (term === pushedRef) return;
    setPushedRef(term);
    apply({ ref: term });
  };

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="space-y-2">
        <SearchInput
          id="error-ref"
          label="Reference"
          labelVisible
          value={refValue}
          onValueChange={setRefValue}
          onDebouncedChange={searchNow}
          placeholder="E-7K2P9QXM"
          className="w-full sm:w-48"
          inputClassName="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="error-severity">Severity</Label>
        <Select
          value={severity ?? ANY}
          onValueChange={(value) => apply({ severity: value })}
          disabled={pending}
        >
          <SelectTrigger id="error-severity" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any severity</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="security">Security</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="error-window">Period</Label>
        <Select
          value={initialWindow}
          onValueChange={(value) => apply({ window: value })}
          disabled={pending}
        >
          <SelectTrigger id="error-window" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(ERROR_LOG_WINDOWS).map((key) => (
              <SelectItem key={key} value={key}>
                Last {key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {initialRef || code || severity ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setRefValue("");
            setPushedRef(null);
            apply({ ref: null, code: null, severity: null, schoolId: null });
          }}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}
