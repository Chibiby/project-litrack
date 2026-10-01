import { RoleAccountsPage, type AccountsSearchParams } from "@/components/admin/role-accounts-page";

export { ACCOUNTS_LIST_KEYS } from "@/components/admin/role-accounts-page";

export const dynamic = "force-dynamic";

export default async function AdminTeachersPage({
  searchParams,
}: {
  searchParams: Promise<AccountsSearchParams>;
}) {
  return <RoleAccountsPage role="TEACHER" searchParams={searchParams} />;
}
