"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import type { SchoolTransferKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Surface } from "@/components/ui/surface";
import { Label } from "@/components/ui/label";
import { SearchInput, SEARCH_BAR_WIDTH } from "@/components/ui/search-input";
import { ConfirmAction } from "@/components/confirm-action";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { cancelSchoolTransfers } from "@/lib/actions/school-transfer";
import { SCHOOL_TRANSFER_KIND_LABELS, SCHOOL_TRANSFER_KIND_SINGULAR_LABELS } from "@/lib/constants/enum-labels";
import type { PlacementOptions, TransferCandidate, TransferRow, TransferTarget } from "@/lib/transfers/queries";
import { callAction } from "@/lib/ui/call-action";
import { ToastedError, toastFailure } from "@/lib/ui/toast-failure";
import { cn } from "@/lib/utils";
import { CandidateTable, TransferRowTable } from "./transfer-table";
import { countOf, SELECT_CLASS, SendTransferDialog } from "./send-transfer-dialog";
import { AcceptTransferDialog, DeclineTransferDialog } from "./accept-transfer-dialog";

export type TransferView = "send" | "outgoing" | "incoming" | "history";
type RowView = Exclude<TransferView, "send">;

/** Rows drawn at once on Send; a large school narrows by search or grade. */
export const SEND_LIST_LIMIT = 100;

export interface TransferWorkspaceProps {
  /** The school whose side every action acts on. */
  schoolId: string;
  kind: SchoolTransferKind;
  /** This school's division; null when it has none set. */
  division: string | null;
  targets: TransferTarget[];
  candidates: TransferCandidate[];
  rows: Record<RowView, TransferRow[]>;
  placement: PlacementOptions;
}

const VIEW_LABELS: Record<TransferView, string> = {
  send: "Send",
  outgoing: "Outgoing",
  incoming: "Incoming",
  history: "History",
};

const EMPTY: Record<TransferView, (people: string) => string> = {
  send: (people) => `No ${people} to transfer.`,
  outgoing: () => "No outgoing transfers waiting.",
  incoming: () => "No incoming transfers.",
  history: () => "No transfers in the last 90 days.",
};

/**
 * One kind's transfers for one school: send people out, cancel what is still
 * waiting, accept or decline what other schools sent, and look back.
 * The kind tabs are routes (the page owns them); these four views are local.
 */
export function TransferWorkspace({
  schoolId,
  kind,
  division,
  targets,
  candidates,
  rows,
  placement,
}: TransferWorkspaceProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [view, setView] = useState<TransferView>(rows.incoming.length > 0 ? "incoming" : "send");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendIds, setSendIds] = useState<string[] | null>(null);
  const [cancelIds, setCancelIds] = useState<string[] | null>(null);
  const [acceptIds, setAcceptIds] = useState<string[] | null>(null);
  const [declineIds, setDeclineIds] = useState<string[] | null>(null);

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const groups = [...new Set(candidates.map((c) => c.group).filter(Boolean))];
  const needle = query.trim().toLowerCase();
  const matching = candidates.filter(
    (c) => (!needle || c.name.toLowerCase().includes(needle)) && (!group || c.group === group)
  );
  const shownCandidates = matching.slice(0, SEND_LIST_LIMIT);
  const people = SCHOOL_TRANSFER_KIND_LABELS[kind].toLowerCase();
  const peopleLabel = kind === "ARAL_VOLUNTEER" ? "ARAL volunteers" : people;
  const listItems = view === "send" ? shownCandidates : rows[view];
  const selectableIds = new Set(
    view === "send"
      ? candidates.filter((c) => c.pendingTo === null).map((c) => c.id)
      : view === "history"
        ? []
        : rows[view].filter((r) => r.status === "PENDING").map((r) => r.id)
  );
  const picked = [...selected].filter((id) => selectableIds.has(id));

  // A refresh can drop rows; keep only ids still on screen.
  const [prevKey, setPrevKey] = useState({ view, candidates, rows });
  if (prevKey.view !== view || prevKey.candidates !== candidates || prevKey.rows !== rows) {
    setPrevKey({ view, candidates, rows });
    if (prevKey.view !== view) setSelected(new Set());
    else setSelected((prev) => new Set([...prev].filter((id) => selectableIds.has(id))));
  }

  const settle = () => {
    setSelected(new Set());
    startTransition(() => {
      invalidateNavWarm();
      router.refresh();
    });
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // On Send, "select all" means the people on screen (after search and grade).
  const toggleAll = (on: boolean) => {
    if (view !== "send") return setSelected(on ? new Set(selectableIds) : new Set());
    const onScreen = shownCandidates.filter((c) => c.pendingTo === null).map((c) => c.id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of onScreen) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const cancel = async (ids: string[]) => {
    const res = await callAction(() => cancelSchoolTransfers({ schoolId, ids }));
    if (!res.ok) {
      toastFailure(res);
      throw new ToastedError(res.error);
    }
    toast.success(`${countOf(res.data.count, kind)} kept here. The transfer was cancelled.`);
    settle();
  };

  const noDivision = !division?.trim();
  const counts: Record<TransferView, number | null> = {
    send: null,
    outgoing: rows.outgoing.length,
    incoming: rows.incoming.length,
    history: null,
  };

  return (
    <Surface as="section" aria-label={`${SCHOOL_TRANSFER_KIND_LABELS[kind]} transfers`} className="space-y-4 rounded-lg px-3 py-4 sm:px-4">
      <div role="tablist" aria-label="Transfer lists" className="flex overflow-x-auto overflow-y-hidden border-b border-border/70">
        {(Object.keys(VIEW_LABELS) as TransferView[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`transfer-tab-${v}`}
            aria-selected={view === v}
            aria-controls="transfer-panel"
            onClick={() => setView(v)}
            className={cn(
              "-mb-px flex h-11 shrink-0 items-center gap-2 rounded-none border-b-2 px-2 text-sm sm:px-3 font-medium transition-colors lg:h-9",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === v
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {VIEW_LABELS[v]}
            {counts[v] ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                  v === "incoming" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {counts[v]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div id="transfer-panel" role="tabpanel" aria-labelledby={`transfer-tab-${view}`} className="space-y-3">
        {view === "send" && noDivision ? (
          <Callout variant="warning" className="max-w-2xl">
            Set this school&apos;s division before transferring. Transfers go only to schools in the same division.
          </Callout>
        ) : view === "send" && targets.length === 0 ? (
          <Callout variant="info" className="max-w-2xl">
            There is no other active school in {division} to transfer to yet.
          </Callout>
        ) : (
          <>
            {view === "send" && candidates.length > 10 ? (
              <div className="flex flex-wrap items-end gap-2">
                <SearchInput
                  label={`Search ${peopleLabel}`}
                  placeholder="Search by name"
                  value={query}
                  onValueChange={setQuery}
                  className={SEARCH_BAR_WIDTH}
                />
                {groups.length > 1 ? (
                  <div className="w-full space-y-1 sm:w-44">
                    <Label htmlFor="transfer-group" className="sr-only">
                      Grade
                    </Label>
                    <select
                      id="transfer-group"
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">All grades</option>
                      {groups.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}
            {view === "send" && matching.length > shownCandidates.length ? (
              <p className="text-xs text-muted-foreground">
                Showing {shownCandidates.length} of {matching.length}. Search or pick a grade to narrow the list.
              </p>
            ) : null}
            {view === "send" && candidates.length > 0 && matching.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No {peopleLabel} match your search.</p>
            ) : null}
            {view !== "history" && (view === "send" ? candidates.length > 0 : listItems.length > 0) ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {view === "send"
                    ? `Tick the ${peopleLabel} to send. They stay here until the other school accepts.`
                    : view === "outgoing"
                      ? "Sent from your school and still waiting for an answer."
                      : "Sent to your school by other schools in the division."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {view === "send" ? (
                    <Button type="button" disabled={picked.length === 0} onClick={() => setSendIds(picked)}>
                      Transfer to another school ({picked.length})
                    </Button>
                  ) : null}
                  {view === "outgoing" ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={picked.length === 0}
                      onClick={() => setCancelIds(picked)}
                    >
                      Cancel transfer ({picked.length})
                    </Button>
                  ) : null}
                  {view === "incoming" ? (
                    <>
                      <Button type="button" disabled={picked.length === 0} onClick={() => setAcceptIds(picked)}>
                        Accept ({picked.length})
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={picked.length === 0}
                        onClick={() => setDeclineIds(picked)}
                      >
                        Decline ({picked.length})
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {view === "send" && candidates.length > 0 && matching.length === 0 ? null : listItems.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Inbox className="size-4" aria-hidden />
                {EMPTY[view](peopleLabel)}
              </p>
            ) : view === "send" ? (
              <CandidateTable
                candidates={shownCandidates}
                selected={selected}
                onToggle={toggle}
                onToggleAll={toggleAll}
                label={SCHOOL_TRANSFER_KIND_LABELS[kind]}
              />
            ) : (
              <TransferRowTable
                rows={rows[view]}
                view={view}
                selected={selected}
                onToggle={toggle}
                onToggleAll={toggleAll}
                label={`${VIEW_LABELS[view]} ${SCHOOL_TRANSFER_KIND_SINGULAR_LABELS[kind]} transfers`}
              />
            )}
          </>
        )}
      </div>

      <SendTransferDialog
        schoolId={schoolId}
        kind={kind}
        ids={sendIds}
        targets={targets}
        onClose={() => setSendIds(null)}
        onDone={settle}
      />
      <AcceptTransferDialog
        schoolId={schoolId}
        kind={kind}
        ids={acceptIds}
        placement={placement}
        onClose={() => setAcceptIds(null)}
        onDone={settle}
      />
      <DeclineTransferDialog
        schoolId={schoolId}
        kind={kind}
        ids={declineIds}
        onClose={() => setDeclineIds(null)}
        onDone={settle}
      />
      {cancelIds ? (
        <ConfirmAction
          open
          onOpenChange={(next) => {
            if (!next) setCancelIds(null);
          }}
          title={`Cancel ${countOf(cancelIds.length, kind)}?`}
          description="They stay at your school. The receiving school can no longer accept them."
          confirmLabel="Cancel transfer"
          cancelLabel="Keep waiting"
          onConfirm={() => cancel(cancelIds)}
        />
      ) : null}
    </Surface>
  );
}
