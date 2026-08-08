import { SettingsShell } from "@/components/settings/settings-shell";

export default function SchoolHeadSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsShell
      roleBase="/school-head"
      profileSubtitle="Update your school head profile"
    >
      {children}
    </SettingsShell>
  );
}
