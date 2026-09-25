import { AdminSettingsShell } from "@/components/settings/admin-settings-shell";

export default function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminSettingsShell>{children}</AdminSettingsShell>;
}
