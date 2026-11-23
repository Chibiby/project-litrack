import { TabNav } from "@/components/school-head/tab-nav";
import { SCHOOL_TRANSFER_KIND_LABELS } from "@/lib/constants/enum-labels";
import {
  loadTransferWorkspace,
  TRANSFER_KIND_PARAMS,
  type TransferKindParam,
} from "@/lib/transfers/queries";
import { TransferWorkspace } from "./transfer-workspace";

/**
 * Server half of the Transfer page, shared by the School Head page and the
 * District admin page: loads one school's lists for one kind, then renders the
 * kind tabs (routes) and the client workspace. The caller has already resolved
 * that it may act for `schoolId`.
 */
export async function TransferPanel({
  schoolId,
  kindParam,
  kindHref,
}: {
  schoolId: string;
  kindParam: TransferKindParam;
  /** The URL of a kind tab, keeping the page's own params. */
  kindHref: (param: TransferKindParam) => string;
}) {
  const kind = TRANSFER_KIND_PARAMS[kindParam];
  let data: Awaited<ReturnType<typeof loadTransferWorkspace>>;
  try {
    data = await loadTransferWorkspace(schoolId, kind);
  } catch (err) {
    console.error("[TransferPanel] failed to load transfers:", err);
    return <p className="text-sm text-destructive">Could not load transfers right now. The database may be unavailable.</p>;
  }

  return (
    <div className="space-y-4">
      <TabNav
        label="Who to transfer"
        activeKey={kindParam}
        items={(Object.keys(TRANSFER_KIND_PARAMS) as TransferKindParam[]).map((param) => ({
          key: param,
          label: SCHOOL_TRANSFER_KIND_LABELS[TRANSFER_KIND_PARAMS[param]],
          href: kindHref(param),
          ...(data.incomingCounts[TRANSFER_KIND_PARAMS[param]] > 0
            ? { count: data.incomingCounts[TRANSFER_KIND_PARAMS[param]], emphasizeCount: true }
            : {}),
        }))}
      />
      {/* Keyed so switching kind or school starts the views afresh. */}
      <TransferWorkspace
        key={`${schoolId}:${kind}`}
        schoolId={schoolId}
        kind={kind}
        division={data.division}
        targets={data.targets}
        candidates={data.candidates}
        rows={data.rows}
        placement={data.placement}
      />
    </div>
  );
}
