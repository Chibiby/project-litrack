"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { triggerDownload } from "@/components/reports/trigger-download";
import { exportMosyReport } from "@/lib/actions/aral-mosy-export";

type ExportChoice = { format: "EXCEL" | "PDF"; purpose: "PRINT" | "RECORDS" };

const FILTER_KEYS = ["q", "grade", "section", "status"] as const;

export function MosyExportButton() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  async function run({ format, purpose }: ExportChoice) {
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("format", format);
      fd.set("purpose", purpose);
      for (const key of FILTER_KEYS) {
        const value = searchParams.get(key);
        if (value) fd.set(key, value);
      }
      const res = await exportMosyReport(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      triggerDownload(res.data.base64, res.data.filename);
      toast.success("MOSY report downloaded");
    } catch {
      toast.error("Could not export the MOSY report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label="Export MOSY report"
          className="h-11 gap-1.5 lg:h-9"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
          {busy ? "Exporting…" : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Excel (.xlsx)</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void run({ format: "EXCEL", purpose: "PRINT" })}>
          Excel for printing
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run({ format: "EXCEL", purpose: "RECORDS" })}>
          Excel for records
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run({ format: "PDF", purpose: "PRINT" })}>
          PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
