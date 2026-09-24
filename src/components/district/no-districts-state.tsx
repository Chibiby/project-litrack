import { MapPinOff } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

/** Shown on every district page while the admin has no district assigned. */
export function NoDistrictsState() {
  return (
    <EmptyState
      title="No districts assigned yet"
      description="Your account is not linked to any district, so there are no schools to show. Ask the division office to assign your districts."
      icon={MapPinOff}
    />
  );
}
