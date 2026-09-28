import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Landing pad for a password recovery email — a real page, not a route
 * handler, so the emailed `token_hash` is never consumed on GET.
 *
 * Mail scanners and "safe link" prefetchers follow a link with a bare GET
 * before a person ever sees it. The old shape of this route called
 * `supabase.auth.verifyOtp` straight from GET, so a scanner's visit burned
 * the token and the actual recipient saw "invalid or has expired" on a link
 * that had never been clicked. This page only reads the query params to
 * decide what to show — it never verifies them. The token is spent only when
 * the person submits the form below, which POSTs to
 * `/auth/confirm/verify` (a route handler, so the resulting session cookies
 * are actually written to the response). No script here submits that form
 * automatically.
 */

export const dynamic = "force-dynamic";

const INVALID_LINK_MESSAGE = "This reset link is invalid or has expired. Request a new one.";

export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash;
  const type = params.type;
  const linkLooksValid = Boolean(tokenHash) && type === "recovery";

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <Image
            src="/logo.webp"
            alt="ARAL Program logo"
            width={192}
            height={256}
            priority
            className="mx-auto h-28 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
        </div>
        <Card className="rounded-xl border border-border/80 shadow-sm">
          <CardContent className="space-y-4 pt-6 text-center text-sm">
            {linkLooksValid ? (
              <>
                <p className="text-muted-foreground">
                  You followed a password reset link for your LITRACK account. Continue to set a
                  new password.
                </p>
                <form method="POST" action="/auth/confirm/verify">
                  <input type="hidden" name="token_hash" value={tokenHash} />
                  <input type="hidden" name="type" value={type} />
                  <Button type="submit" className="w-full">
                    Continue to reset password
                  </Button>
                </form>
              </>
            ) : (
              <>
                <p className="text-destructive">{INVALID_LINK_MESSAGE}</p>
                <Link href="/forgot-password" className="underline hover:text-foreground">
                  Request a new reset link
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
