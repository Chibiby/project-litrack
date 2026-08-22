"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/confirm-action";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "@/lib/actions/announcement";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

export function CreateAnnouncementForm() {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        startTransition(async () => {
          const res = await createAnnouncement(fd);
          if (!res.ok) toast.error(res.error);
          else {
            toast.success("Announcement published");
            (document.getElementById("announcement-form") as HTMLFormElement | null)?.reset();
          }
        })
      }
      id="announcement-form"
    >
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required disabled={pending} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="body">Body</Label>
        <Textarea id="body" name="body" rows={4} required disabled={pending} />
      </div>
      <Button type="submit" loading={pending} loadingText="Publishing…">
        Publish
      </Button>
    </form>
  );
}

export type AnnouncementListItem = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  publishedAt: string;
};

export function AnnouncementActions({
  announcementId,
  title,
  body,
  pending,
  onDelete,
}: {
  announcementId: string;
  title: string;
  body: string;
  pending?: boolean;
  onDelete?: () => void | Promise<void>;
}) {
  const [localPending, startTransition] = useTransition();
  const isPending = Boolean(pending) || localPending;

  const runStandaloneDelete = () =>
    runOptimistic(startTransition, async () => {
      const fd = new FormData();
      fd.set("announcementId", announcementId);
      const res = await deleteAnnouncement(fd);
      await settleActionResult(res, "Announcement deleted");
    });

  return (
    <div className="space-y-3 border-t border-border/60 pt-3">
      <form
        className="space-y-3"
        action={(fd) =>
          startTransition(async () => {
            const res = await updateAnnouncement(fd);
            if (!res.ok) toast.error(res.error);
            else toast.success("Announcement updated");
          })
        }
      >
        <input type="hidden" name="announcementId" value={announcementId} />
        <Input name="title" defaultValue={title} disabled={isPending} />
        <Textarea name="body" defaultValue={body} rows={3} disabled={isPending} />
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            loading={isPending}
            loadingText="Saving…"
          >
            Save
          </Button>
          <ConfirmAction
            title="Delete this announcement?"
            description="It will be removed from the school feed."
            confirmLabel="Delete"
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
      </form>
    </div>
  );
}

/** Client list so delete can remove the row before the server returns. */
export function AnnouncementsList({
  announcements,
  readOnly = false,
}: {
  announcements: AnnouncementListItem[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticItems, dispatchOptimistic] = useOptimistic(
    announcements,
    (state: AnnouncementListItem[], op: ListOptimisticOp<AnnouncementListItem>) =>
      listOptimisticReducer(state, op)
  );

  const remove = (id: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id });
      const fd = new FormData();
      fd.set("announcementId", id);
      const res = await deleteAnnouncement(fd);
      await settleActionResult(res, "Announcement deleted");
    });

  return (
    <ul className="space-y-4">
      {optimisticItems.map((a) => (
        <li key={a.id} className="rounded-lg border border-border/80 p-4">
          <h3 className="font-semibold">{a.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {a.body}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {a.authorName} · {a.publishedAt}
          </p>
          {!readOnly ? (
            <AnnouncementActions
              announcementId={a.id}
              title={a.title}
              body={a.body}
              pending={pending}
              onDelete={() => remove(a.id)}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
