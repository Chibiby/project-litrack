"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  commitLearnerImport,
  getLearnerImportTemplate,
  previewLearnerImport,
} from "@/lib/actions/import-learners";
import {
  LEARNER_CSV_HEADERS,
  normalizeLearnerCsvHeader,
  type ImportRowResult,
} from "@/lib/learners/import-csv";
import { Download, FileUp, Loader2, ArrowLeft } from "lucide-react";

type Step = "upload" | "preview" | "done";

type Props = {
  gradeLevelId: string;
  gradeLabel: string;
};

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function LearnerImportWizard({ gradeLevelId, gradeLabel }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [summary, setSummary] = useState({
    valid: 0,
    invalid: 0,
    duplicateWarnings: 0,
  });
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [commitStats, setCommitStats] = useState<{
    imported: number;
    skippedInvalid: number;
    skippedDuplicate: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const validCount = useMemo(
    () => results.filter((r) => r.ok && (allowDuplicates || !r.duplicateWarning)).length,
    [results, allowDuplicates]
  );

  function handleTemplate() {
    startTransition(async () => {
      const res = await getLearnerImportTemplate();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      downloadBlob("litrack-learner-import-template.csv", res.data.csv, "text/csv;charset=utf-8");
      toast.success("Template downloaded");
    });
  }

  function handleFile(file: File | null) {
    if (!file) return;
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => normalizeLearnerCsvHeader(h),
      complete: (parsed) => {
        if (parsed.errors.length > 0 && !parsed.data.length) {
          toast.error(parsed.errors[0]?.message ?? "Failed to parse CSV");
          return;
        }
        const rows = parsed.data.filter((r) =>
          LEARNER_CSV_HEADERS.some((h) => String(r[h] ?? "").trim())
        );
        if (rows.length === 0) {
          toast.error("No data rows found in CSV");
          return;
        }
        setRawRows(rows);
        startTransition(async () => {
          const res = await previewLearnerImport({ gradeLevelId, rows });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          setResults(res.data.results);
          setSummary(res.data.summary);
          setStep("preview");
        });
      },
      error: (err) => toast.error(err.message),
    });
  }

  function handleCommit() {
    startTransition(async () => {
      const res = await commitLearnerImport({
        gradeLevelId,
        rows: rawRows,
        allowDuplicates,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCommitStats({
        imported: res.data.imported,
        skippedInvalid: res.data.skippedInvalid,
        skippedDuplicate: res.data.skippedDuplicate,
      });
      setResults(res.data.results);
      setStep("done");
      toast.success(`Imported ${res.data.imported} learner(s)`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/grade/${gradeLevelId}`}>
            <ArrowLeft className="h-4 w-4" /> Back to {gradeLabel}
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTemplate}
          disabled={pending}
        >
          <Download className="h-4 w-4" /> Download CSV template
        </Button>
      </div>

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Import learners</CardTitle>
            <CardDescription>
              Upload a CSV matching Section A fields for {gradeLabel}. Valid rows are
              imported; invalid rows are reported and skipped (not all-or-nothing).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center hover:bg-muted/50">
              <FileUp className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">Choose CSV file</span>
              <span className="text-xs text-muted-foreground">
                Headers: {LEARNER_CSV_HEADERS.join(", ")}
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                disabled={pending}
              />
            </label>
            {pending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing and validating…
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {step === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {summary.valid} valid · {summary.invalid} invalid ·{" "}
              {summary.duplicateWarnings} duplicate warning(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="allowDup"
                checked={allowDuplicates}
                onCheckedChange={(v) => setAllowDuplicates(v === true)}
              />
              <Label htmlFor="allowDup" className="text-sm font-normal">
                Import rows flagged as possible duplicates (same school name + age)
              </Label>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name / errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.rowNumber}>
                      <TableCell>{r.rowNumber}</TableCell>
                      <TableCell>
                        {r.ok ? (
                          r.duplicateWarning ? (
                            <Badge variant="secondary">Duplicate?</Badge>
                          ) : r.sectionWarning ? (
                            <Badge variant="secondary">Section?</Badge>
                          ) : (
                            <Badge>Valid</Badge>
                          )
                        ) : (
                          <Badge variant="destructive">Error</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.ok ? (
                          <span>
                            {r.data.firstName} {r.data.lastName}, age {r.data.age}
                            {r.data.sectionName ? ` · ${r.data.sectionName}` : ""}
                            {r.sectionWarning ? (
                              <span className="mt-0.5 block text-xs text-amber-800">
                                {r.sectionWarning}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-destructive">
                            {r.rawPreview ? `${r.rawPreview}: ` : ""}
                            {r.errors.join("; ")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setResults([]);
                  setRawRows([]);
                }}
                disabled={pending}
              >
                Choose another file
              </Button>
              <Button
                type="button"
                onClick={handleCommit}
                disabled={pending || validCount === 0}
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Import ${validCount} valid row(s)`
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && commitStats && (
        <Card>
          <CardHeader>
            <CardTitle>Import complete</CardTitle>
            <CardDescription>
              Imported {commitStats.imported} · skipped invalid{" "}
              {commitStats.skippedInvalid} · skipped duplicates{" "}
              {commitStats.skippedDuplicate}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/teacher/grade/${gradeLevelId}`}>View learners</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep("upload");
                setResults([]);
                setRawRows([]);
                setCommitStats(null);
              }}
            >
              Import another file
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
