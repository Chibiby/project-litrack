"use client";

import { RouteError } from "@/components/errors/route-error";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

export default function SchoolHeadError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="School head"
      homeHref={SCHOOL_HEAD_ROUTES.dashboard}
      homeLabel="Back to dashboard"
    />
  );
}
