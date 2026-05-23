import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { deleteSchool } from "@/lib/actions/school";

export const dynamic = "force-dynamic";

export default async function SchoolsListPage() {
  await requireUser("SUPER_ADMIN");
  const schools = await prisma.school.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, schoolIdCode: true, region: true, division: true, isActive: true,
      _count: { select: { users: true, learners: true } },
    },
  });

  return (
    <AppShell title="Schools" subtitle="All registered schools">
      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/admin/schools/new"><Plus className="h-4 w-4" /> New school</Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>School ID</TableHead>
                <TableHead>Region / Division</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Learners</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No schools yet.</TableCell></TableRow>
              ) : schools.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><code className="text-xs">{s.schoolIdCode}</code></TableCell>
                  <TableCell className="text-muted-foreground">{[s.region, s.division].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell className="text-right">{s._count.users}</TableCell>
                  <TableCell className="text-right">{s._count.learners}</TableCell>
                  <TableCell className="text-right">
                    <form action={deleteSchool}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button variant="ghost" size="sm" type="submit" className="text-destructive">Delete</Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
