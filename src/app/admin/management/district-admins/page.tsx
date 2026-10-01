import { RoleAccountsPage, type AccountsSearchParams } from "@/components/admin/role-accounts-page";

export const dynamic = "force-dynamic";

export default async function AdminDistrictAdminsPage({
  searchParams,
}: {
  searchParams: Promise<AccountsSearchParams>;
}) {
  return <RoleAccountsPage role="DISTRICT_ADMIN" searchParams={searchParams} />;
}
