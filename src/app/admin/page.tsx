import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { School, Users, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireUser("SUPER_ADMIN");

  const [schoolCount, userCount] = await Promise.all([
    prisma.school.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
  ]);

  return (
    <AppShell title="Admin Dashboard" subtitle="System-wide overview">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total schools</CardDescription>
            <CardTitle className="text-3xl">{schoolCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <School className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total users</CardDescription>
            <CardTitle className="text-3xl">{userCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Users className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild>
              <Link href="/admin/schools/new"><Plus className="h-4 w-4" /> New school</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/schools">Manage schools</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
