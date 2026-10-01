import { RoleAccountsPage, type AccountsSearchParams } from "@/components/admin/role-accounts-page";

export const dynamic = "force-dynamic";

/** Developer Controls: SUPER_ADMIN accounts. A Division Admin gets a 404. */
export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<AccountsSearchParams>;
}) {
  return <RoleAccountsPage role="SUPER_ADMIN" searchParams={searchParams} />;
}
