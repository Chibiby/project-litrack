"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";

/**
 * The body of every route error boundary.
 *
 * The person is told what to do, never what broke: the digest is the whole of
 * what is safe to show here, and `onRequestError` has already filed the full
 * error under that same digest for `/admin/errors`. The admin boundary used to
 * name Prisma, Vercel and schema drift — on a page a signed-out visitor to
 * /admin/login could reach.
 */
export function RouteError({
  error,
  reset,
  scope,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
  homeHref: string;
  homeLabel: string;
}) {
  useEffect(() => {
    // A cancelled soft navigation should not leave the person on a fatal modal.
    if (error.name === "AbortError") {
      reset();
      return;
    }
    console.error(`${scope} route error:`, error);
  }, [error, reset, scope]);

  if (error.name === "AbortError") return null;

  return (
    <ErrorCard
      icon={AlertTriangle}
      title="This page couldn't load"
      description="Something went wrong on our side. Try again — if it keeps happening, give your administrator the reference below."
      reference={error.digest ?? null}
    >
      <Button type="button" onClick={reset}>
        Try again
      </Button>
      <Button asChild variant="outline">
        <Link href={homeHref}>{homeLabel}</Link>
      </Button>
    </ErrorCard>
  );
}
