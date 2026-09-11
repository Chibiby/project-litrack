import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/errors/error-card";

export function NotFoundContent({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <ErrorCard
      icon={FileQuestion}
      tone="primary"
      title="Page not found"
      description={
        <>
          <span className="mb-1 block text-sm font-medium text-primary">404</span>
          This page doesn&apos;t exist, or it may have moved. Here&apos;s where you can go instead.
        </>
      }
    >
      {links.map((link, index) => (
        <Button key={link.href} asChild variant={index === 0 ? "default" : "outline"}>
          <Link href={link.href}>{link.label}</Link>
        </Button>
      ))}
    </ErrorCard>
  );
}
