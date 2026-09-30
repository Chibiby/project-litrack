"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/confirm-action";
import {
  createSection,
  createNextLetterSection,
  updateSection,
  deleteSection,
} from "@/lib/actions/section";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  tempOptimisticId,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";
import { callAction } from "@/lib/ui/call-action";
import { ToastedError, toastFailure } from "@/lib/ui/toast-failure";

export function CreateSectionForm({
  grades,
}: {
  grades: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        startTransition(async () => {
          const res = await callAction(() => createSection(fd));
          if (!res.ok) toastFailure(res);
          else {
            toast.success("Section created");
            form.reset();
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="gradeLevelId">Grade level</Label>
        <select
          id="gradeLevelId"
          name="gradeLevelId"
          required
          disabled={pending}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">Select grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Section name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Mabini"
          required
          maxLength={100}
          autoCapitalize="words"
          disabled={pending}
        />
      </div>
      <Button type="submit" loading={pending} loadingText="Saving…">
        Add section
      </Button>
    </form>
  );
}

type SectionItem = { id: string; name: string; learnerCount: number };

const removeDescription = (name: string) =>
  `"${name}" will be hidden from teachers, and any adviser assigned to it is unassigned.`;

export function SectionRowActions({
  sectionId,
  name,
  learnerCount = 0,
  pending,
  onRequestRemove,
  onRename,
}: {
  sectionId: string;
  name: string;
  learnerCount?: number;
  pending?: boolean;
  /** When set, the parent owns the confirmation dialog (see `GradeSectionsPanel`). */
  onRequestRemove?: () => void;
  onRename?: (name: string) => void | Promise<void>;
}) {
  const [localPending, startTransition] = useTransition();
  const isPending = Boolean(pending) || localPending;
  const hasLearners = learnerCount > 0;
  const blockedId = useId();

  const runStandaloneUpdate = (fd: FormData) =>
    runOptimistic(startTransition, async () => {
      const res = await updateSection(fd);
      await settleActionResult(res, "Section updated");
    });

  const runStandaloneDelete = () =>
    runOptimistic(startTransition, async () => {
      const fd = new FormData();
      fd.set("sectionId", sectionId);
      const res = await deleteSection(fd);
      await settleActionResult(res, "Section removed");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2 max-lg:w-full"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const nextName = String(fd.get("name") ?? "").trim();
          if (onRename) {
            void Promise.resolve(onRename(nextName)).catch(() => {
              /* toast already shown */
            });
            return;
          }
          void runStandaloneUpdate(fd).catch(() => {
            /* toast already shown */
          });
        }}
      >
        <input type="hidden" name="sectionId" value={sectionId} />
        <Input
          name="name"
          defaultValue={name}
          className="w-36 max-lg:w-full max-lg:flex-1 max-lg:min-w-0 max-sm:h-11 lg:h-10"
          maxLength={100}
          autoCapitalize="words"
          disabled={isPending}
          aria-label="Section name"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          loading={isPending}
          loadingText="Saving…"
          className="lg:h-9"
        >
          Rename section
        </Button>
      </form>
      {hasLearners ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive lg:h-9"
            disabled
            aria-describedby={blockedId}
          >
            Remove
          </Button>
          <p id={blockedId} className="text-xs text-muted-foreground">
            Move its {learnerCount} {learnerCount === 1 ? "learner" : "learners"} to
            another section first
          </p>
        </div>
      ) : onRequestRemove ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive lg:h-9"
          disabled={isPending}
          onClick={onRequestRemove}
        >
          Remove
        </Button>
      ) : (
        <ConfirmAction
          title="Remove this section?"
          description={removeDescription(name)}
          confirmLabel="Remove"
          variant="destructive"
          disabled={isPending}
          trigger={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive lg:h-9"
              disabled={isPending}
            >
              Remove
            </Button>
          }
          onConfirm={runStandaloneDelete}
        />
      )}
    </div>
  );
}

function nextLetterPreview(names: string[]): string | null {
  const used = new Set(
    names
      .map((n) => n.trim().toUpperCase())
      .filter((n) => /^[A-Z]$/.test(n))
  );
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return null;
}

export function GradeSectionsPanel({
  gradeLevelId,
  sections,
  readOnly = false,
}: {
  gradeLevelId: string;
  sections: SectionItem[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Held here, not in the row: the optimistic removal unmounts the row, which
  // would close a dialog mounted inside it before the server has answered.
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [optimisticSections, dispatchOptimistic] = useOptimistic(
    sections,
    (state: SectionItem[], op: ListOptimisticOp<SectionItem>) =>
      listOptimisticReducer(state, op)
  );
  const nextLetter = nextLetterPreview(optimisticSections.map((s) => s.name));

  const deleteRow = (sectionId: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id: sectionId });
      const fd = new FormData();
      fd.set("sectionId", sectionId);
      const res = await deleteSection(fd);
      await settleActionResult(res, "Section removed");
    });

  const renameRow = (sectionId: string, name: string) =>
    runOptimistic(startTransition, async () => {
      if (!name) {
        toast.error("Section name is required");
        throw new ToastedError("Section name is required");
      }
      dispatchOptimistic({ type: "patch", id: sectionId, patch: { name } });
      const fd = new FormData();
      fd.set("sectionId", sectionId);
      fd.set("name", name);
      const res = await updateSection(fd);
      await settleActionResult(res, "Section updated");
    });

  const appendSection = (
    name: string,
    action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>,
    successMessage: string
  ) =>
    runOptimistic(startTransition, async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error("Section name is required");
        throw new ToastedError("Section name is required");
      }
      dispatchOptimistic({
        type: "append",
        item: { id: tempOptimisticId("section"), name: trimmed, learnerCount: 0 },
      });
      const fd = new FormData();
      fd.set("gradeLevelId", gradeLevelId);
      fd.set("name", trimmed);
      const res = await action(fd);
      await settleActionResult(res, successMessage);
    });

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground">Sections</p>

      <ConfirmAction
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
        title="Remove this section?"
        description={removeDescription(removeTarget?.name ?? "")}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => (removeTarget ? deleteRow(removeTarget.id) : undefined)}
      />

      {optimisticSections.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sections yet</p>
      ) : (
        <ul className="space-y-2">
          {optimisticSections.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2"
            >
              {readOnly ? (
                <span className="text-sm font-medium max-lg:min-w-0 max-lg:break-words">{s.name}</span>
              ) : (
                <SectionRowActions
                  sectionId={s.id}
                  name={s.name}
                  learnerCount={s.learnerCount}
                  pending={pending}
                  onRequestRemove={() => setRemoveTarget({ id: s.id, name: s.name })}
                  onRename={(name) => renameRow(s.id, name)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <form
            className="flex flex-1 flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = String(new FormData(form).get("name") ?? "");
              void appendSection(name, createSection, "Section created")
                .then(() => form.reset())
                .catch(() => {
                  /* toast already shown; the typed name stays for a retry */
                });
            }}
          >
            <input type="hidden" name="gradeLevelId" value={gradeLevelId} />
            <div className="min-w-[8rem] flex-1 space-y-1">
              <Label htmlFor={`section-name-${gradeLevelId}`} className="text-xs">
                Custom name
              </Label>
              <Input
                id={`section-name-${gradeLevelId}`}
                name="name"
                placeholder="e.g. Mabini"
                required
                maxLength={100}
                autoCapitalize="words"
                disabled={pending}
                className="max-sm:h-11 lg:h-10"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={pending}
              loadingText="Saving…"
              className="lg:h-9"
            >
              Add
            </Button>
          </form>

          <form
            action={() => {
              if (!nextLetter) return;
              void appendSection(
                nextLetter,
                createNextLetterSection,
                `Section ${nextLetter} created`
              ).catch(() => {
                /* toast already shown */
              });
            }}
          >
            <input type="hidden" name="gradeLevelId" value={gradeLevelId} />
            <Button
              type="submit"
              size="sm"
              disabled={pending || !nextLetter}
              className="lg:h-9"
              title={
                nextLetter
                  ? `Quick-add section ${nextLetter}`
                  : "All letters A–Z are already used"
              }
            >
              {nextLetter ? `Quick-add ${nextLetter}` : "Letters full"}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
