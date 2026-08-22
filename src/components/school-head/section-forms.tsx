"use client";

import { useOptimistic, useTransition } from "react";
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

export function CreateSectionForm({
  grades,
}: {
  grades: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        startTransition(async () => {
          const res = await createSection(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success("Section created");
        })
      }
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
        <Input id="name" name="name" placeholder="e.g. Mabini" required disabled={pending} />
      </div>
      <Button type="submit" loading={pending} loadingText="Saving…">
        Add section
      </Button>
    </form>
  );
}

type SectionItem = { id: string; name: string };

export function SectionRowActions({
  sectionId,
  name,
  pending,
  onDelete,
  onRename,
}: {
  sectionId: string;
  name: string;
  pending?: boolean;
  onDelete?: () => void | Promise<void>;
  onRename?: (name: string) => void | Promise<void>;
}) {
  const [localPending, startTransition] = useTransition();
  const isPending = Boolean(pending) || localPending;

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
        className="flex items-center gap-2"
        action={(fd) => {
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
          className="h-8 w-36"
          disabled={isPending}
          aria-label="Section name"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          loading={isPending}
          loadingText="Saving…"
        >
          Save
        </Button>
      </form>
      <ConfirmAction
        title="Remove this section?"
        description={`"${name}" will be hidden from teachers. You can recreate it later if needed.`}
        confirmLabel="Remove"
        variant="destructive"
        disabled={isPending}
        trigger={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={isPending}
          >
            Delete
          </Button>
        }
        onConfirm={onDelete ?? runStandaloneDelete}
      />
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
        throw new Error("Section name is required");
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
        throw new Error("Section name is required");
      }
      dispatchOptimistic({
        type: "append",
        item: { id: tempOptimisticId("section"), name: trimmed },
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
                <span className="text-sm font-medium">{s.name}</span>
              ) : (
                <SectionRowActions
                  sectionId={s.id}
                  name={s.name}
                  pending={pending}
                  onDelete={() => deleteRow(s.id)}
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
            action={(fd) => {
              const name = String(fd.get("name") ?? "");
              void appendSection(name, createSection, "Section created").catch(() => {
                /* toast already shown */
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
                disabled={pending}
                className="h-8"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={pending}
              loadingText="Saving…"
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
