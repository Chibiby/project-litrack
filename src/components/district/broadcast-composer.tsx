"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AppForm, useAppForm } from "@/components/forms/app-form";
import { broadcastAnnouncement } from "@/lib/actions/district-announcements";
import {
  broadcastAnnouncementSchema,
  type BroadcastAnnouncementInput,
  type BroadcastTarget,
} from "@/lib/validators/announcement.schema";

type TargetKind = BroadcastTarget["kind"];

export type BroadcastSchoolOption = { id: string; name: string; district: string | null };

/**
 * Compose one announcement for many schools. The target only names schools;
 * `broadcastAnnouncement` resolves every kind through the caller's own scope
 * and refuses the whole send if any school is outside it.
 */
export function BroadcastComposer({
  districts,
  schools,
  allLabel,
}: {
  districts: string[];
  schools: BroadcastSchoolOption[];
  /** "All my districts" or, for the division office, "Every school". */
  allLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [schoolQuery, setSchoolQuery] = useState("");
  const form = useAppForm<BroadcastAnnouncementInput>({
    schema: broadcastAnnouncementSchema,
    defaultValues: { title: "", body: "", target: { kind: "all" } },
  });

  const target = form.watch("target");
  const selectedIds = target.kind === "schools" ? target.schoolIds : [];
  // The target is a union, so RHF's error type for it cannot name the nested
  // keys; read the three places a target error can sit.
  const targetError = form.formState.errors.target as
    | { message?: string; district?: { message?: string }; schoolIds?: { message?: string } }
    | undefined;
  const targetMessage =
    targetError?.message ?? targetError?.schoolIds?.message ?? targetError?.district?.message;

  const visibleSchools = useMemo(() => {
    const q = schoolQuery.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((school) => school.name.toLowerCase().includes(q));
  }, [schools, schoolQuery]);

  const setTarget = (next: BroadcastTarget) =>
    form.setValue("target", next, { shouldValidate: form.formState.isSubmitted });

  const chooseKind = (kind: TargetKind) => {
    if (kind === "all") setTarget({ kind: "all" });
    else if (kind === "district") setTarget({ kind: "district", district: districts[0] ?? "" });
    else setTarget({ kind: "schools", schoolIds: [] });
  };

  const toggleSchool = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds, id]
      : selectedIds.filter((selected) => selected !== id);
    setTarget({ kind: "schools", schoolIds: next });
  };

  const recipientCount =
    target.kind === "all"
      ? schools.length
      : target.kind === "district"
        ? schools.filter((school) => school.district === target.district).length
        : selectedIds.length;

  return (
    <AppForm
      form={form}
      className="space-y-5"
      onSubmit={(values) => {
        startTransition(async () => {
          const res = await broadcastAnnouncement(values);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          const count = res.data.schoolCount;
          toast.success(count === 1 ? "Sent to 1 school" : `Sent to ${count} schools`);
          form.reset({ title: "", body: "", target: { kind: "all" } });
          setSchoolQuery("");
          router.refresh();
        });
      }}
    >
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>Title</FormLabel>
            <FormControl>
              <Input maxLength={200} disabled={pending} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="body"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>Message</FormLabel>
            <FormControl>
              <Textarea rows={5} maxLength={5000} disabled={pending} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <fieldset className="space-y-3" disabled={pending}>
        <legend className="text-sm font-medium">Send to</legend>
        <RadioGroup
          value={target.kind}
          onValueChange={(value) => chooseKind(value as TargetKind)}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {(
            [
              { kind: "all", label: allLabel },
              { kind: "district", label: "One district" },
              { kind: "schools", label: "Chosen schools" },
            ] as const
          ).map((option) => (
            <Label
              key={option.kind}
              htmlFor={`broadcast-target-${option.kind}`}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-3 font-normal sm:min-h-10"
            >
              <RadioGroupItem
                value={option.kind}
                id={`broadcast-target-${option.kind}`}
                disabled={option.kind === "district" && districts.length === 0}
                className="max-lg:size-5"
              />
              {option.label}
            </Label>
          ))}
        </RadioGroup>

        {target.kind === "district" ? (
          <div className="space-y-1.5">
            <Label htmlFor="broadcast-district">District</Label>
            <Select
              value={target.district}
              onValueChange={(district) => setTarget({ kind: "district", district })}
            >
              <SelectTrigger id="broadcast-district" className="w-full sm:w-72">
                <SelectValue placeholder="Choose a district" />
              </SelectTrigger>
              <SelectContent>
                {districts.map((district) => (
                  <SelectItem key={district} value={district}>
                    {district}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {target.kind === "schools" ? (
          <div className="space-y-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={schoolQuery}
                onChange={(event) => setSchoolQuery(event.target.value)}
                placeholder="Find a school…"
                aria-label="Find a school"
                className="pl-9"
              />
            </div>
            <ul
              className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/80"
              aria-label="Schools"
            >
              {visibleSchools.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No school matches that name.
                </li>
              ) : (
                visibleSchools.map((school) => {
                  const id = `broadcast-school-${school.id}`;
                  return (
                    <li key={school.id}>
                      <label
                        htmlFor={id}
                        className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50 sm:min-h-10"
                      >
                        <Checkbox
                          id={id}
                          checked={selectedIds.includes(school.id)}
                          onCheckedChange={(checked) => toggleSchool(school.id, checked === true)}
                          className="max-lg:size-5"
                        />
                        <span className="min-w-0 flex-1 truncate">{school.name}</span>
                        {school.district ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {school.district}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ) : null}

        {targetMessage ? (
          <p className="text-sm font-medium text-destructive">{targetMessage}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {recipientCount === 1
            ? "1 school will receive this."
            : `${recipientCount} schools will receive this.`}{" "}
          School Heads see it on their Announcements page and cannot edit or delete it.
        </p>
      </fieldset>

      <Button
        type="submit"
        className="w-full sm:w-auto"
        disabled={recipientCount === 0}
        loading={pending}
        loadingText="Sending…"
      >
        <Send aria-hidden />
        Send announcement
      </Button>
    </AppForm>
  );
}
