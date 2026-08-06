"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function TeacherError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Teacher route error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Teacher page error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong loading this page. If the database is unavailable,
          try again later.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-muted-foreground">Digest: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/teacher">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
