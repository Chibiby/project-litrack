"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "@/lib/actions/announcement";

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
      <Button type="submit" disabled={pending}>
        {pending ? "Publishing…" : "Publish"}
      </Button>
    </form>
  );
}

export function AnnouncementActions({
  announcementId,
  title,
  body,
}: {
  announcementId: string;
  title: string;
  body: string;
}) {
  const [pending, startTransition] = useTransition();

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
        <Input name="title" defaultValue={title} disabled={pending} />
        <Textarea name="body" defaultValue={body} rows={3} disabled={pending} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this announcement?")) return;
              const fd = new FormData();
              fd.set("announcementId", announcementId);
              startTransition(async () => {
                const res = await deleteAnnouncement(fd);
                if (!res.ok) toast.error(res.error);
                else toast.success("Announcement deleted");
              });
            }}
          >
            Delete
          </Button>
        </div>
      </form>
    </div>
  );
}
