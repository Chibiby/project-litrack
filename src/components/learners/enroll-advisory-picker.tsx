"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";

/**
 * Which advisory the Enroll and Promote dialogs act on. A one-advisory teacher
 * sees their section as plain text; a multi-advisory teacher picks one, and the
 * list below it follows.
 */
export function EnrollAdvisoryPicker({
  id,
  placements,
  value,
  onChange,
  disabled,
}: {
  id: string;
  placements: AdvisoryPlacement[];
  value: string;
  onChange: (sectionId: string) => void;
  disabled?: boolean;
}) {
  if (placements.length === 1) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">Advisory: </span>
        <span className="font-medium">{placements[0].label}</span>
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Advisory</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full sm:w-80">
          <SelectValue placeholder="Choose an advisory section" />
        </SelectTrigger>
        <SelectContent>
          {placements.map((p) => (
            <SelectItem key={p.sectionId} value={p.sectionId}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
