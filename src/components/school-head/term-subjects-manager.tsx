"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, Plus, RotateCcw } from "lucide-react";
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
  archiveTermSubject,
  createTermSubject,
  renameTermSubject,
  restoreTermSubject,
  reorderTermSubjects,
} from "@/lib/actions/term-subjects";
import { cn } from "@/lib/utils";

export type ActiveTermSubject = { id: string; name: string; position: number };
export type ArchivedTermSubject = { id: string; name: string; deletedAt: string };

type ManagerState = {
  active: ActiveTermSubject[];
  archived: ArchivedTermSubject[];
};

type Op =
  | { type: "create"; item: ActiveTermSubject }
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
        .filter((s): s is ActiveTermSubject => Boolean(s));
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

export function TermSubjectsManager({
  gradeLevelId,
  gradeLabel,
  max,
  initialActive,
  initialArchived,
}: {
  gradeLevelId: string;
  gradeLabel: string;
  max: number;
  initialActive: ActiveTermSubject[];
  initialArchived: ArchivedTermSubject[];
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
  const capMessage = `A grade can have at most ${max} subjects. Archive one first.`;

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
        item: { id: tempOptimisticId("term-subject"), name, position: state.active.length },
      });
      const res = await createTermSubject({ gradeLevelId, name });
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
      const res = await renameTermSubject({ id, name: trimmed });
      await settleActionResult(res, "Subject renamed");
    });

  const archive = (id: string, name: string) =>
    runOptimistic(startTransition, async () => {
      dispatch({ type: "archive", id });
      const res = await archiveTermSubject({ id });
      await settleActionResult(res, `${name} archived`);
    });

  const restore = (id: string, name: string) =>
    runOptimistic(startTransition, async () => {
      if (atCap) {
        toast.error(capMessage);
        throw new Error(capMessage);
      }
      dispatch({ type: "restore", id });
      const res = await restoreTermSubject({ id });
      await settleActionResult(res, `${name} restored`);
    });

  const reorder = (orderedIds: string[]) =>
    runOptimistic(startTransition, async () => {
      dispatch({ type: "reorder", orderedIds });
      const res = await reorderTermSubjects({ gradeLevelId, orderedIds });
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
              {gradeLabel}&rsquo;s subjects
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These are the columns on this grade&rsquo;s End of Terms sheet, in
              order.
            </p>
          </div>
          <Badge variant={atCap ? "secondary" : "outline"}>
            {state.active.length} / {max}
          </Badge>
        </SurfaceHeader>
        <SurfaceBody className="space-y-4">
          {state.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subjects yet. Add the first one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {state.active.map((subject, index) => (
                <TermSubjectRow
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
              <Label htmlFor={`new-subject-${gradeLevelId}`} className="text-xs">
                Add a subject
              </Label>
              <Input
                id={`new-subject-${gradeLevelId}`}
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
        <button
          type="button"
          id={`${archivedRegionId}-trigger`}
          aria-expanded={archivedOpen}
          aria-controls={archivedRegionId}
          onClick={() => setArchivedOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <span className="text-sm font-semibold">
            Archived subjects ({state.archived.length})
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              archivedOpen && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {archivedOpen ? (
          <SurfaceBody
            id={archivedRegionId}
            role="region"
            aria-labelledby={`${archivedRegionId}-trigger`}
            className="border-t border-border/60 pt-4"
          >
            {state.archived.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing archived on this grade.
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

function TermSubjectRow({
  subject,
  pending,
  isFirst,
  isLast,
  onRename,
  onArchive,
  onMoveUp,
  onMoveDown,
}: {
  subject: ActiveTermSubject;
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
        description={`${subject.name} will disappear from this grade's End of Terms sheet, export and reports. Recorded scores are kept and come back if you restore it.`}
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
