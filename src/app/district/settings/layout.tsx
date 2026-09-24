import { SettingsShell } from "@/components/settings/settings-shell";

export default function DistrictSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsShell
      roleBase="/district"
      profileSubtitle="Update your display name"
      securitySubtitle="Change your password"
    >
      {children}
    </SettingsShell>
  );
}
