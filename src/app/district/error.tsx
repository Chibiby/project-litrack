"use client";

import { RouteError } from "@/components/errors/route-error";

export default function DistrictError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="District" homeHref="/district" homeLabel="Back to overview" />;
}
