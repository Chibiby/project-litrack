import { SettingsShell } from "@/components/settings/settings-shell";

export default function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsShell
      roleBase="/admin"
      profileSubtitle="Update your Super Admin display name"
    >
      {children}
    </SettingsShell>
  );
}
