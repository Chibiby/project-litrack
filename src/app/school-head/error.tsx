"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SchoolHeadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("School-head route error:", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
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
            <Link href="/login">Back to login</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
