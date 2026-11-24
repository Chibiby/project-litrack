import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { parseTransferKind } from "@/lib/transfers/queries";
import { TransferPanel } from "./transfer-panel";

/**
 * The cross-school transfer workspace for one school the admin picks, shared
 * by the Division Admin and District admin Transfer pages. Unlike a School
 * Head, who only ever acts for their own school, an admin first chooses the
 * school a learner, teacher or ARAL volunteer is moving from, then sends,
 * cancels, accepts or declines exactly as that school's head would
 * (`resolveTransferActor` checks the scope again on every action).
 *
 * `schools` must already be limited to the caller's scope: a `school` param
 * that is not in it is treated as not chosen, and never queried.
 */
export function SchoolTransfersSection({
  schools,
  schoolParam,
  kindParam,
  basePath,
}: {
  schools: { id: string; name: string }[];
  schoolParam: string;
  kindParam: string | undefined;
  /** The page the school picker and kind tabs navigate to. */
  basePath: string;
}) {
  const schoolId = schoolParam && schools.some((school) => school.id === schoolParam) ? schoolParam : "";
  const { param } = parseTransferKind(kindParam);
  const href = (kind: string) => `${basePath}?school=${encodeURIComponent(schoolId)}&kind=${kind}`;

  return (
    <Surface as="section" aria-labelledby="school-transfers-title" className="min-w-0 rounded-lg">
      <SurfaceHeader className="flex-col gap-1 px-4 sm:px-5 lg:flex-row lg:gap-3">
        <h2 id="school-transfers-title" className="text-base font-semibold">
          Transfers between schools
        </h2>
        <p className="text-sm text-muted-foreground">
          Learners, teachers and ARAL volunteers. Nobody moves until the receiving school accepts.
        </p>
      </SurfaceHeader>
      <SurfaceBody className="space-y-4 p-4 sm:p-5">
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-full space-y-1.5 sm:max-w-sm sm:basis-auto">
            <Label htmlFor="transfer-school">School they are moving from</Label>
            <select
              id="transfer-school"
              name="school"
              defaultValue={schoolId}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm lg:h-9"
            >
              <option value="">Choose a school</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>
          <input type="hidden" name="kind" value={param} />
          <Button type="submit" variant="outline">
            Show transfers
          </Button>
        </form>
        {schoolId ? (
          <TransferPanel schoolId={schoolId} kindParam={param} kindHref={href} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a school to send its people, or to answer transfers sent to it.
          </p>
        )}
      </SurfaceBody>
    </Surface>
  );
}
