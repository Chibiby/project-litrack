import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ErrorState({
  title,
  description,
  digest,
  onReset,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  description: string;
  digest?: string;
  onReset?: () => void;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-sm font-bold">
            LT
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          {digest ? <p className="text-xs text-muted-foreground">Digest: {digest}</p> : null}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {onReset ? (
              <Button type="button" onClick={onReset}>
                Try again
              </Button>
            ) : null}
            {primaryHref && primaryLabel ? (
              <Button asChild variant={onReset ? "outline" : "default"}>
                <Link href={primaryHref}>{primaryLabel}</Link>
              </Button>
            ) : null}
            {secondaryHref && secondaryLabel ? (
              <Button asChild variant="outline">
                <Link href={secondaryHref}>{secondaryLabel}</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
