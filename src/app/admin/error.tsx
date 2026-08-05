"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <ErrorState
      title="Admin page error"
      description="Something went wrong loading this page. If this keeps happening, check that DATABASE_URL on Vercel uses a valid Supabase connection string (not a placeholder password)."
      digest={error.digest}
      onReset={reset}
      primaryHref="/admin"
      primaryLabel="Back to dashboard"
    />
  );
}
