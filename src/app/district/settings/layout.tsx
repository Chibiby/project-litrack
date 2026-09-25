// Chrome lives in each page (`AppShell` plus `DistrictSettingsShell`), the
// same per-page composition as `/school-head/settings`. This layout stays only
// as the route segment's required file.
export default function DistrictSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
