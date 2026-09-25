"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { startTestLabSession } from "@/lib/actions/accounts";
import type { TestLabChecklistItem } from "@/lib/test-lab/checklist";

const STORAGE_KEY = "litrack:test-lab:checklist-checked";

/** Never throws: the checklist must render with or without `localStorage`. */
function readChecked(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeChecked(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Best-effort only — private browsing / quota errors leave the in-memory
    // state as the sole record for this session.
  }
}

function personaFor(role: TestLabChecklistItem["role"]): "head" | "teacher" {
  return role === "SCHOOL_HEAD" ? "head" : "teacher";
}

const ROLE_LABELS: Record<TestLabChecklistItem["role"], string> = {
  SCHOOL_HEAD: "School Head",
  TEACHER: "Teacher",
};

function ChecklistRow({
  item,
  checked,
  onToggle,
}: {
  item: TestLabChecklistItem;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("persona", personaFor(item.role));
      fd.set("next", item.href);
      const res = await startTestLabSession(fd);
      // Success redirects, so only a failure returns here.
      if (res && !res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle(item.id)}
        aria-label={`Checked: ${item.label}`}
        className="relative before:absolute before:-inset-3 before:content-[''] lg:before:inset-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground lg:truncate">{item.label}</p>
        <p className="font-mono text-xs text-muted-foreground lg:truncate">{item.href}</p>
      </div>
      <Button type="button" size="sm" variant="outline" loading={pending} onClick={open}>
        Open
      </Button>
    </div>
  );
}

export function TestLabChecklist({ items }: { items: TestLabChecklistItem[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // localStorage is unavailable during SSR, so the server-rendered pass
    // always shows an empty checklist; `hydrated` keeps that first client
    // render matching it, then this effect syncs in the real, persisted
    // checked set without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage (external system) after mount; a lazy initializer would run during hydration and mismatch the server-rendered empty state
    setChecked(readChecked());
    setHydrated(true);
  }, []);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeChecked(next);
      return next;
    });
  }

  function clear() {
    setChecked(new Set());
    writeChecked(new Set());
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Prepare test data first — the checklist needs a demo grade, section and learner to link to.
      </p>
    );
  }

  const roles: TestLabChecklistItem["role"][] = ["SCHOOL_HEAD", "TEACHER"];
  const checkedCount = hydrated ? items.filter((i) => checked.has(i.id)).length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {checkedCount} of {items.length} checked
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={checkedCount === 0}>
          Clear checks
        </Button>
      </div>

      {roles.map((role) => {
        const roleItems = items.filter((i) => i.role === role);
        if (roleItems.length === 0) return null;
        const groups = [...new Set(roleItems.map((i) => i.group))];
        return (
          <Card key={role}>
            <CardHeader>
              <CardTitle>{ROLE_LABELS[role]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {groups.map((group) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                  <div className="space-y-2">
                    {roleItems
                      .filter((i) => i.group === group)
                      .map((item) => (
                        <ChecklistRow
                          key={item.id}
                          item={item}
                          checked={checked.has(item.id)}
                          onToggle={toggle}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
