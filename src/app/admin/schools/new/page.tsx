import { School } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { CreateSchoolForm } from "@/components/forms/create-school-form";

export default async function NewSchoolPage() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <AdminPage
      title="New school"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Schools"
          eyebrowIcon={School}
          title="New school"
          subtitle="Provision a new school and its School Head login."
        />
      }
    >
      <CreateSchoolForm />
    </AdminPage>
  );
}
