"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

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
    <ErrorState
      title="School Head page error"
      description="Something went wrong loading this page. If the database is unavailable, try again later."
      digest={error.digest}
      onReset={reset}
      primaryHref="/school-head"
      primaryLabel="Dashboard"
      secondaryHref="/login"
      secondaryLabel="Login"
    />
  );
}
