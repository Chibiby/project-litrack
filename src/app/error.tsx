"use client";

import { RouteError } from "@/components/errors/route-error";

export default function AppError(props: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}) {
  return <RouteError {...props} scope="App" homeHref="/" homeLabel="Back to home" />;
}
