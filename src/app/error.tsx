"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <ErrorState
      title="Something went wrong"
      description="Please try again. If this keeps happening, contact your administrator."
      digest={error.digest}
      onReset={reset}
      primaryHref="/login"
      primaryLabel="Back to login"
    />
  );
}
