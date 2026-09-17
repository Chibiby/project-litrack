"use client";

// Deliberately duplicated from `src/components/school-head/term-subjects-manager.tsx`
// rather than generalised: same shape, different action module and no `gradeLevelId`/
// `schoolId` scoping (this table is tenant-less, scoped only by `gradeLevelType`).
// Extraction candidate if a third caller ever needs this pattern.

import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, Plus, RotateCcw } from "lucide-react";
import type { GradeLevelType } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { ConfirmAction } from "@/components/confirm-action";
import {
  runOptimistic,
  settleActionResult,
  tempOptimisticId,
} from "@/lib/ui/optimistic";
import {
  archiveTermSubjectDefault,
  createTermSubjectDefault,
  renameTermSubjectDefault,
  restoreTermSubjectDefault,
  reorderTermSubjectDefaults,
} from "@/lib/actions/term-subject-defaults";
import { cn } from "@/lib/utils";

export type ActiveTermSubjectDefault = { id: string; name: string; position: number };
export type ArchivedTermSubjectDefault = { id: string; name: string; deletedAt: string };

type ManagerState = {
  active: ActiveTermSubjectDefault[];
  archived: ArchivedTermSubjectDefault[];
};

type Op =
  | { type: "create"; item: ActiveTermSubjectDefault }
  | { type: "rename"; id: string; name: string }
  | { type: "archive"; id: string }
  | { type: "restore"; id: string }
  | { type: "reorder"; orderedIds: string[] };

function reducer(state: ManagerState, op: Op): ManagerState {
  switch (op.type) {
    case "create":
      return { ...state, active: [...state.active, op.item] };
    case "rename":
      return {
        ...state,
        active: state.active.map((s) =>
          s.id === op.id ? { ...s, name: op.name } : s
        ),
      };
    case "archive": {
      const subject = state.active.find((s) => s.id === op.id);
      if (!subject) return state;
      return {
        active: state.active.filter((s) => s.id !== op.id),
        archived: [
          { id: subject.id, name: subject.name, deletedAt: new Date().toISOString() },
          ...state.archived,
        ],
      };
    }
    case "restore": {
      const subject = state.archived.find((s) => s.id === op.id);
      if (!subject) return state;
      return {
        archived: state.archived.filter((s) => s.id !== op.id),
        active: [
          ...state.active,
          { id: subject.id, name: subject.name, position: state.active.length },
        ],
      };
    }
    case "reorder": {
      const byId = new Map(state.active.map((s) => [s.id, s]));
      const reordered = op.orderedIds
        .map((id) => byId.get(id))
        .filter((s): s is ActiveTermSubjectDefault => Boolean(s));
      // A permutation of the current list — anything else means the server
      // and the client have already drifted, so keep the list as it was
      // rather than dropping a row from the screen.
      if (reordered.length !== state.active.length) return state;
      return { ...state, active: reordered };
    }
    default:
      return state;
  }
}

const swallow = () => {
  /* toast already shown by settleActionResult / the caller */
};

export function TermSubjectDefaultsManager({
  gradeLevelType,
  gradeLabel,
  max,
  initialActive,
  initialArchived,
}: {
  gradeLevelType: GradeLevelType;
  gradeLabel: string;
  max: number;
  initialActive: ActiveTermSubjectDefault[];
  initialArchived: ArchivedTermSubjectDefault[];
}) {
  const [pending, startTransition] = useTransition();
  const [state, dispatch] = useOptimistic(
    { active: initialActive, archived: initialArchived } satisfies ManagerState,
    reducer
  );
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const archivedRegionId = useId();

  const atCap = state.active.length >= max;
  const capMessage = `A grade type can have at most ${max} default subjects. Archive one first.`;

  const create = () =>
    runOptimistic(startTransition, async () => {
      const name = newName.trim();
      if (!name) {
        toast.error("Subject name is required");
        throw new Error("Subject name is required");
      }
      if (atCap) {
        toast.error(capMessage);
        throw new Error(capMessage);
      }
      dispatch({
        type: "create",
        item: { id: tempOptimisticId("term-subject-default"), name, position: state.active.length },
      });
      const res = await createTermSubjectDefault({ gradeLevelType, name });
      await settleActionResult(res, `${name} added`);
      setNewName("");
    });

  const rename = (id: string, name: string) =>
    runOptimistic(startTransition, async () => {
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error("Subject name is required");
        throw new Error("Subject name is required");
      }
      dispatch({ type: "rename", id, name: trimmed });
      const res = await renameTermSubjectDefault({ id, name: trimmed });
      await settleActionResult(res, "Subject renamed");
    });

  const archive = (id: string, name: string) =>
    runOptimistic(startTransition, async () => {
      dispatch({ type: "archive", id });
      const res = await archiveTermSubjectDefault({ id });
      await settleActionResult(res, `${name} archived`);
    });

  const restore = (id: string, name: string) =>
    runOptimistic(startTransition, async () => {
      if (atCap) {
        toast.error(capMessage);
        throw new Error(capMessage);
      }
      dispatch({ type: "restore", id });
      const res = await restoreTermSubjectDefault({ id });
      await settleActionResult(res, `${name} restored`);
    });

  const reorder = (orderedIds: string[]) =>
    runOptimistic(startTransition, async () => {
      dispatch({ type: "reorder", orderedIds });
      const res = await reorderTermSubjectDefaults({ gradeLevelType, orderedIds });
      if (!res.ok) {
        toast.error(res.error);
        throw new Error(res.error);
      }
    });

  function move(id: string, direction: -1 | 1) {
    const index = state.active.findIndex((s) => s.id === id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= state.active.length) return;
    const next = [...state.active];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    void reorder(next.map((s) => s.id)).catch(swallow);
  }

  return (
    <div className="space-y-6">
      <Surface as="section">
        <SurfaceHeader className="items-center">
          <div>
            <h2 className="text-sm font-semibold">
              {gradeLabel}&rsquo;s default subjects
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              New schools and school-wide resets seed this grade type&rsquo;s
              End of Terms sheet from this list, in order.
            </p>
          </div>
          <Badge variant={atCap ? "secondary" : "outline"}>
            {state.active.length} / {max}
          </Badge>
        </SurfaceHeader>
        <SurfaceBody className="space-y-4">
          {state.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No default subjects yet. Add the first one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {state.active.map((subject, index) => (
                <TermSubjectDefaultRow
                  key={subject.id}
                  subject={subject}
                  pending={pending}
                  isFirst={index === 0}
                  isLast={index === state.active.length - 1}
                  onRename={(name) => void rename(subject.id, name).catch(swallow)}
                  onArchive={() => archive(subject.id, subject.name)}
                  onMoveUp={() => move(subject.id, -1)}
                  onMoveDown={() => move(subject.id, 1)}
                />
              ))}
            </ul>
          )}

          <form
            className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create().catch(swallow);
            }}
          >
            <div className="min-w-[10rem] flex-1 space-y-1.5">
              <Label htmlFor={`new-subject-default-${gradeLevelType}`} className="text-xs">
                Add a default subject
              </Label>
              <Input
                id={`new-subject-default-${gradeLevelType}`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Filipino"
                maxLength={60}
                disabled={pending || atCap}
                className="h-9"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={pending || atCap}
              loading={pending}
              loadingText="Saving…"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add subject
            </Button>
          </form>
          {atCap ? (
            <p className="text-xs text-muted-foreground">{capMessage}</p>
          ) : null}
        </SurfaceBody>
      </Surface>

      <Surface as="section">
        <Button
          type="button"
          variant="ghost"
          id={`${archivedRegionId}-trigger`}
          aria-expanded={archivedOpen}
          aria-controls={archivedRegionId}
          onClick={() => setArchivedOpen((open) => !open)}
          className="h-auto w-full justify-between gap-3 rounded-none px-5 py-4 text-left font-semibold hover:bg-transparent"
        >
          <span className="text-sm font-semibold">
            Archived default subjects ({state.archived.length})
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              archivedOpen && "rotate-180"
            )}
            aria-hidden
          />
        </Button>
        {archivedOpen ? (
          <SurfaceBody
            id={archivedRegionId}
            role="region"
            aria-labelledby={`${archivedRegionId}-trigger`}
            className="border-t border-border/60 pt-4"
          >
            {state.archived.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing archived on this grade type.
              </p>
            ) : (
              <ul className="space-y-2">
                {state.archived.map((subject) => (
                  <li
                    key={subject.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/80 px-3 py-2"
                  >
                    <span className="text-sm text-muted-foreground">
                      {subject.name}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void restore(subject.id, subject.name).catch(swallow)}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceBody>
        ) : null}
      </Surface>
    </div>
  );
}

function TermSubjectDefaultRow({
  subject,
  pending,
  isFirst,
  isLast,
  onRename,
  onArchive,
  onMoveUp,
  onMoveDown,
}: {
  subject: ActiveTermSubjectDefault;
  pending: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onArchive: () => void | Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 px-3 py-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={pending || isFirst}
          onClick={onMoveUp}
          aria-label={`Move ${subject.name} up`}
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={pending || isLast}
          onClick={onMoveDown}
          aria-label={`Move ${subject.name} down`}
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <form
        className="flex flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onRename(String(fd.get("name") ?? ""));
        }}
      >
        <Input
          name="name"
          defaultValue={subject.name}
          maxLength={60}
          disabled={pending}
          aria-label="Subject name"
          className="h-8 min-w-[10rem] flex-1"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Save
        </Button>
      </form>

      <ConfirmAction
        title={`Archive "${subject.name}"?`}
        description={`${subject.name} will disappear from this grade type's default template. New schools and resets stop seeding it. Recorded scores on schools that already have it are untouched, and it comes back if you restore it.`}
        confirmLabel="Archive"
        variant="destructive"
        disabled={pending}
        trigger={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
          >
            Archive
          </Button>
        }
        onConfirm={onArchive}
      />
    </li>
  );
}
