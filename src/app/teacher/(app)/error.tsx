"use client";

import { RouteError } from "@/components/errors/route-error";

export default function TeacherError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="Teacher" homeHref="/teacher" homeLabel="Back to dashboard" />;
}
