import { requireUser } from "@/lib/auth/session";
import { DemoSettings } from "@/components/admin/demo-settings";
import { demoStatus } from "@/lib/demo/provision";
import { readDemoSession } from "@/lib/demo/session";

export const dynamic = "force-dynamic";

/**
 * Uncached on purpose, like the database console: this page's entire job is to
 * tell the admin the state of the demo tenant *right now*, immediately before
 * they act on it. A stale read here would be mistaken for the result of the
 * action they just took — and the demo session it reports belongs to this
 * browser alone, so it could never be cached across requests anyway.
 */
export default async function AdminDemoSettingsPage() {
  await requireUser("SUPER_ADMIN");

  const [session, status] = await Promise.all([readDemoSession(), demoStatus()]);

  return (
    <DemoSettings
      data={{
        sessionExpiresAt: session?.expiresAt ?? null,
        complete: status.complete,
        any: status.any,
        districtName: status.districtName,
        schoolIdCode: status.schoolIdCode,
        schools: status.schools.map((s) => ({ name: s.name, exists: s.exists })),
      }}
    />
  );
}
