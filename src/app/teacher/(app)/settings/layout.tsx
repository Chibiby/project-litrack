import { SettingsShell } from "@/components/settings/settings-shell";

export default function TeacherSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsShell
      roleBase="/teacher"
      profileSubtitle="Update your teacher profile"
    >
      {children}
    </SettingsShell>
  );
}
