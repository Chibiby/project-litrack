"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

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
    <ErrorState
      title="Teacher page error"
      description="Something went wrong loading this page. If the database is unavailable, try again later."
      digest={error.digest}
      onReset={reset}
      primaryHref="/teacher"
      primaryLabel="Dashboard"
      secondaryHref="/login"
      secondaryLabel="Login"
    />
  );
}
