import { Info } from "lucide-react";
import { Callout } from "@/components/ui/callout";

/** How the figures are counted, and what the DOCX asks for that no field records. */
export function SummaryNotes({ notes, gaps }: { notes: readonly string[]; gaps: readonly string[] }) {
  if (notes.length === 0 && gaps.length === 0) return null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      {notes.length > 0 ? (
        <Callout variant="info" icon={Info} title="How these figures are counted">
          <ul className="list-disc space-y-1 pl-4">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {gaps.length > 0 ? (
        <Callout variant="warning" title="Not available from LITRACK records">
          <ul className="list-disc space-y-1 pl-4">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}
