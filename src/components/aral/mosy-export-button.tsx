"use client";

import { useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { triggerDownload } from "@/components/reports/trigger-download";
import { exportMosyReport } from "@/lib/actions/aral-mosy-export";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";

type Format = "EXCEL" | "PDF";

const FILTER_KEYS = ["q", "grade", "section", "status"] as const;

export function MosyExportButton() {
  const searchParams = useSearchParams();
  const uid = useId();
  const formatId = `${uid}-format`;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("EXCEL");
  const [busy, setBusy] = useState(false);
  // A ref, not state: two clicks in the same tick would both see busy=false.
  const inFlight = useRef(false);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("format", format);
      fd.set("purpose", "PRINT");
      for (const key of FILTER_KEYS) {
        const value = searchParams.get(key);
        if (value) fd.set(key, value);
      }
      const res = await callAction(() => exportMosyReport(fd));
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      triggerDownload(res.data.base64, res.data.filename);
      toast.success(`Downloaded ${res.data.filename}`);
      setOpen(false);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Export MOSY report"
          className="h-11 gap-1.5 lg:h-9"
        >
          <Download className="size-4" aria-hidden />
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-1.5rem)] space-y-4 p-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor={formatId} className="text-xs font-medium text-muted-foreground">
            Format
          </Label>
          <Select value={format} onValueChange={(v) => setFormat(v as Format)} disabled={busy}>
            <SelectTrigger id={formatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXCEL">Excel (.xlsx)</SelectItem>
              <SelectItem value="PDF">PDF (.pdf)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button type="button" className="w-full gap-1.5" disabled={busy} onClick={() => void run()}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
          {busy ? "Preparing…" : "Download"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
