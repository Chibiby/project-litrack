import { RoleAccountsPage, type AccountsSearchParams } from "@/components/admin/role-accounts-page";

export const dynamic = "force-dynamic";

export default async function AdminSchoolHeadsPage({
  searchParams,
}: {
  searchParams: Promise<AccountsSearchParams>;
}) {
  return <RoleAccountsPage role="SCHOOL_HEAD" searchParams={searchParams} />;
}
