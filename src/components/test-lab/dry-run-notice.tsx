import { Callout } from "@/components/ui/callout";

/**
 * Amber banner shown at the top of a self-bound form (School Head / Teacher
 * profile, password, email) while the current request is a Test Lab dry-run
 * session (`readTestLabSession`). Server component — no client JS needed.
 */
export function DryRunNotice() {
  return (
    <Callout variant="warning" title="Test Lab">
      Nothing on this form will be saved. Submitting checks your entries and
      shows what would be saved.
    </Callout>
  );
}
