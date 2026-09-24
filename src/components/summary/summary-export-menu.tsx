"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ExportPurposeToggle,
  useExportPurpose,
} from "@/components/reports/export-purpose-toggle";
import { exportSummary } from "@/lib/actions/summary-export";
import type { SummaryFacetId, SummaryLevel } from "@/lib/summary/types";

type Format = "EXCEL" | "PDF";

export type SummaryExportRequest = {
  district?: string;
  schoolId?: string;
  level: SummaryLevel;
  month?: string;
  from?: string;
  to?: string;
  schoolYearLabel?: string;
  term?: string;
};

function triggerDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari cancels a download whose object URL is revoked in the same frame.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Excel (For printing / For records) or PDF of the view on screen, with the
 * same layout choice as the Reports hub. The request carries exactly the scope
 * and period the page used, so the file matches the tables.
 */
export function SummaryExportMenu({
  facetId,
  request,
}: {
  facetId: SummaryFacetId;
  request: SummaryExportRequest;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("EXCEL");
  const [purpose, setPurpose] = useExportPurpose();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await exportSummary({
        ...request,
        facet: facetId,
        format,
        // PDF is always the print layout.
        purpose: format === "PDF" ? "PRINT" : purpose,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (!res.data) return;
      triggerDownload(res.data.base64, res.data.filename);
      toast.success("Summary downloaded");
      setOpen(false);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto">
          <Download aria-hidden />
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-4">
        <div>
          <Label htmlFor="summary-export-format" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Format
          </Label>
          <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
            <SelectTrigger id="summary-export-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXCEL">Excel (.xlsx)</SelectItem>
              <SelectItem value="PDF">PDF (.pdf)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Layout</span>
          <ExportPurposeToggle
            value={format === "PDF" ? "PRINT" : purpose}
            onChange={setPurpose}
            disabled={format === "PDF"}
            hideLabel
          />
        </div>
        <Button
          type="button"
          className="w-full"
          onClick={run}
          loading={pending}
          loadingText="Preparing file…"
        >
          <Download aria-hidden />
          Download
        </Button>
      </PopoverContent>
    </Popover>
  );
}
