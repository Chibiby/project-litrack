import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { CreateSchoolForm } from "@/components/forms/create-school-form";

export default async function NewSchoolPage() {
  await requireUser("SUPER_ADMIN");

  return (
    <AppShell title="New School" subtitle="Provision a new school and its School Head login">
      <CreateSchoolForm />
    </AppShell>
  );
}
