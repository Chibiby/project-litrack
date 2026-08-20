"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { Button } from "@/components/ui/button";

export default function SchoolHeadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Cancelled soft navigations should not leave the user on a fatal modal.
    if (error.name === "AbortError") {
      reset();
      return;
    }
    console.error("School-head route error:", error);
  }, [error, reset]);

  if (error.name === "AbortError") {
    return null;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">School Head page error</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong loading this page. If the database is unavailable, try
          again later.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">Digest: {error.digest}</p>
        ) : null}
        <div className="flex justify-center gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href={SCHOOL_HEAD_ROUTES.dashboard}>Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
