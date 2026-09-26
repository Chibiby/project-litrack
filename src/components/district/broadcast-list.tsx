"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { retractBroadcast } from "@/lib/actions/district-announcements";

export type BroadcastListItem = {
  broadcastId: string;
  title: string;
  body: string;
  /** Already formatted on the server, so the day cannot shift on hydration. */
  publishedLabel: string;
  schoolCount: number;
};

/** The admin's own broadcasts, newest first, each retractable in one step. */
export function BroadcastList({ broadcasts }: { broadcasts: BroadcastListItem[] }) {
  const router = useRouter();
  const [retracting, setRetracting] = useState<string | null>(null);

  const retract = async (broadcastId: string) => {
    setRetracting(broadcastId);
    try {
      const res = await retractBroadcast({ broadcastId });
      if (!res.ok) {
        toast.error(res.error);
        throw new Error(res.error);
      }
      const count = res.data.schoolCount;
      toast.success(
        count === 1 ? "Removed from 1 school" : `Removed from ${count} schools`
      );
      router.refresh();
    } finally {
      setRetracting(null);
    }
  };

  return (
    <ul className="space-y-3">
      {broadcasts.map((item) => (
        <li key={item.broadcastId} className="rounded-lg border border-border/80 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-semibold">{item.title}</h3>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {item.body}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{item.publishedLabel}</span>
                <Badge variant="secondary">
                  {item.schoolCount === 1 ? "1 school" : `${item.schoolCount} schools`}
                </Badge>
              </div>
            </div>
            <ConfirmAction
              title="Retract this announcement?"
              description={`"${item.title}" will disappear from ${
                item.schoolCount === 1 ? "1 school" : `${item.schoolCount} schools`
              } right away.`}
              confirmLabel="Retract"
              variant="destructive"
              disabled={retracting !== null}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full shrink-0 sm:w-auto lg:h-9"
                  loading={retracting === item.broadcastId}
                  loadingText="Retracting…"
                >
                  <Undo2 aria-hidden />
                  Retract
                </Button>
              }
              onConfirm={() => retract(item.broadcastId)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
