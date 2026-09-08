import { requireUser } from "@/lib/auth/session";
import { DemoSettings } from "@/components/admin/demo-settings";
import { demoStatus } from "@/lib/demo/provision";
import { isDemoEnabled } from "@/lib/settings/system-settings";

export const dynamic = "force-dynamic";

/**
 * Uncached on purpose, like the database console: this page's entire job is to
 * tell the admin the state of the demo tenant *right now*, immediately before
 * they switch it. A stale read here would be mistaken for the result of the
 * action they just took.
 */
export default async function AdminDemoSettingsPage() {
  await requireUser("SUPER_ADMIN");

  const [enabled, status] = await Promise.all([isDemoEnabled(), demoStatus()]);

  return (
    <DemoSettings
      data={{
        enabled,
        complete: status.complete,
        any: status.any,
        districtName: status.districtName,
        schoolIdCode: status.schoolIdCode,
        schools: status.schools.map((s) => ({ name: s.name, exists: s.exists })),
      }}
    />
  );
}
