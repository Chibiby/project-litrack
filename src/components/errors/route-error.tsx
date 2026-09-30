"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, DatabaseZap, RefreshCw, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";
import { classifyClientFailure } from "@/lib/errors/client";
import type { ErrorCode } from "@/lib/errors/codes";

type Action = "retry" | "reload" | "none";

type Variant = {
  icon: LucideIcon;
  title: string;
  description: string;
  action: Action;
  actionLabel?: string;
  showReference: boolean;
};

const GENERIC: Variant = {
  icon: AlertTriangle,
  title: "This page couldn't load",
  description:
    "Something went wrong while loading this page. Try again — if it keeps happening, give your administrator the reference below.",
  action: "retry",
  actionLabel: "Try again",
  showReference: true,
};

const VARIANTS: Partial<Record<ErrorCode, Variant>> = {
  NETWORK_OFFLINE: {
    icon: WifiOff,
    title: "You're offline",
    description:
      "Check your Wi-Fi or mobile data. This page will reload by itself when your connection is back.",
    action: "none",
    showReference: false,
  },
  SERVER_UNREACHABLE: {
    icon: WifiOff,
    title: "Couldn't reach LITRACK",
    description:
      "The page couldn't connect. Check your connection, then try again.",
    action: "retry",
    actionLabel: "Try again",
    showReference: false,
  },
  APP_UPDATED: {
    icon: RefreshCw,
    title: "LITRACK was updated",
    description:
      "A newer version is available. Reload the page to continue. Anything you typed on this page will need to be entered again.",
    action: "reload",
    actionLabel: "Reload page",
    showReference: false,
  },
  REQUEST_TOO_LARGE: {
    icon: AlertTriangle,
    title: "That was too much to send at once",
    description: "What you sent is too large. Try again with less, or a smaller file.",
    action: "retry",
    actionLabel: "Try again",
    showReference: false,
  },
  DB_UNAVAILABLE: {
    icon: DatabaseZap,
    title: "The database isn't responding",
    description:
      "Wait a moment, then try again. If it keeps happening, give your administrator the reference below.",
    action: "retry",
    actionLabel: "Try again",
    showReference: true,
  },
  DB_SCHEMA_OUT_OF_DATE: {
    icon: DatabaseZap,
    title: "LITRACK needs a database update",
    description:
      "Trying again won't fix this. Ask your administrator to finish the pending update, and give them the reference below.",
    action: "none",
    showReference: true,
  },
};

/**
 * The body of every route error boundary.
 *
 * It says what kind of failure this is (offline, an update, the database, or
 * unknown) and offers the one action that can fix it, but never names
 * infrastructure: the digest is the whole of what is safe to show here, and
 * `onRequestError` has already filed the full error under that same digest for
 * `/admin/errors`. The admin boundary used to name Prisma, Vercel and schema
 * drift — on a page a signed-out visitor to /admin/login could reach.
 *
 * `retry` re-fetches from the server; `reset` only clears the boundary's state
 * and re-renders the same failed payload, so it cannot recover a server failure.
 */
export function RouteError({
  error,
  retry,
  reset,
  scope,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
  scope: string;
  homeHref: string;
  homeLabel: string;
}) {
  const failure = classifyClientFailure(error, { trustDigestWhenOffline: true });
  const offline = failure.code === "NETWORK_OFFLINE";
  const aborted = error.name === "AbortError";

  useEffect(() => {
    // A cancelled soft navigation broke nothing on the server, so the cheap
    // state clear is enough; a refresh would race the navigation that
    // cancelled it.
    if (aborted) {
      reset();
      return;
    }
    console.error(`${scope} route error:`, error);
  }, [aborted, error, reset, scope]);

  useEffect(() => {
    if (!offline || aborted) return;
    const onOnline = () => retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [offline, aborted, retry]);

  if (aborted) return null;

  const variant = VARIANTS[failure.code] ?? GENERIC;

  return (
    <ErrorCard
      icon={variant.icon}
      title={variant.title}
      description={variant.description}
      reference={variant.showReference ? (failure.ref ?? null) : null}
    >
      {variant.action === "retry" ? (
        <Button type="button" onClick={() => retry()}>
          {variant.actionLabel}
        </Button>
      ) : null}
      {variant.action === "reload" ? (
        <Button type="button" onClick={() => window.location.reload()}>
          {variant.actionLabel}
        </Button>
      ) : null}
      <Button asChild variant={variant.action === "none" ? "default" : "outline"}>
        <Link href={homeHref}>{homeLabel}</Link>
      </Button>
    </ErrorCard>
  );
}
