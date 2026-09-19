// Chrome moved into each page: `AppShell` plus `SchoolHeadSettingsShell`,
// mirroring `/teacher/settings`'s per-page composition (no shared layout
// shell there either). This layout stays only as the route segment's
// required file.
export default function SchoolHeadSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
