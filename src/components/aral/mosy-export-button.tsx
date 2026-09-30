"use client";

import { useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { cn } from "@/lib/utils";

type Format = "EXCEL" | "PDF";
type Purpose = "PRINT" | "RECORDS";

const FILTER_KEYS = ["q", "grade", "section", "status"] as const;

// Same vocabulary as the Reports hub. PDF is always the print layout.
const PURPOSES: { value: Purpose; label: string }[] = [
  { value: "PRINT", label: "For printing" },
  { value: "RECORDS", label: "For records" },
];

export function MosyExportButton() {
  const searchParams = useSearchParams();
  const uid = useId();
  const formatId = `${uid}-format`;
  const layoutId = `${uid}-layout`;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("EXCEL");
  const [purpose, setPurpose] = useState<Purpose>("PRINT");
  const [busy, setBusy] = useState(false);
  // A ref, not state: two clicks in the same tick would both see busy=false.
  const inFlight = useRef(false);
  const isPdf = format === "PDF";
  const effectivePurpose: Purpose = isPdf ? "PRINT" : purpose;

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("format", format);
      fd.set("purpose", effectivePurpose);
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

        <div className="space-y-1.5">
          <span id={layoutId} className="text-xs font-medium text-muted-foreground">
            Layout
          </span>
          <RadioGroup
            name="mosy-export-layout"
            value={effectivePurpose}
            onValueChange={(v) => setPurpose(v as Purpose)}
            aria-labelledby={layoutId}
            disabled={busy}
            className="flex flex-row flex-wrap gap-3"
          >
            {PURPOSES.map((opt) => {
              const optDisabled = busy || (isPdf && opt.value === "RECORDS");
              const radioId = `${uid}-${opt.value}`;
              return (
                <div
                  key={opt.value}
                  className={cn(
                    "flex items-center gap-1.5 max-lg:min-h-10",
                    optDisabled && "opacity-50",
                  )}
                >
                  <RadioGroupItem value={opt.value} id={radioId} disabled={optDisabled} />
                  <Label htmlFor={radioId} className="text-xs font-normal">
                    {opt.label}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
          {isPdf && (
            <p className="text-xs text-muted-foreground">PDF is always the print layout.</p>
          )}
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
