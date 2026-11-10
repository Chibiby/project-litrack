import { cn } from "@/lib/utils";

/**
 * Glassmorphism frame shared by every role's dashboard. Cards inside turn
 * translucent and blur one shared light ray (see `.dashboard-glass` in
 * globals.css), so the whole dashboard reads as one seamless pane of glass.
 */
export function DashboardGlass({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("dashboard-glass relative isolate", className)}>
      {/* The single light source the glass cards blur. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="dashboard-glass-ray" />
      </div>
      {children}
    </div>
  );
}
