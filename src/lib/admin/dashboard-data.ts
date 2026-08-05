import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";
import { isPrismaConnectionError } from "@/lib/auth/app-user";

export type RecentSchool = {
  id: string;
  name: string;
  schoolIdCode: string;
};

export type AdminDashboardStats = {
  schoolCount: number;
  userCount: number;
  aralCount: number;
  recentSchools: RecentSchool[];
  dbAvailable: boolean;
  source: "prisma" | "postgrest" | "none";
};

export type SchoolListRow = {
  id: string;
  name: string;
  schoolIdCode: string;
  region: string | null;
  division: string | null;
  isActive: boolean;
  users: number;
  learners: number;
};

async function loadDashboardViaPostgrest(): Promise<AdminDashboardStats | null> {
  if (!getSupabaseServiceEnv().ok) return null;
  try {
    const admin = createSupabaseAdminClient();

    const [schoolsRes, usersRes, aralRes, recentRes] = await Promise.all([
      admin
        .from("School")
        .select("id", { count: "exact", head: true })
        .is("deletedAt", null),
      admin
        .from("User")
        .select("id", { count: "exact", head: true })
        .is("deletedAt", null),
      admin
        .from("Learner")
        .select("id", { count: "exact", head: true })
        .eq("isAralLearner", true)
        .is("deletedAt", null),
      admin
        .from("School")
        .select("id, name, schoolIdCode")
        .is("deletedAt", null)
        .order("createdAt", { ascending: false })
        .limit(5),
    ]);

    if (schoolsRes.error || usersRes.error || aralRes.error || recentRes.error) {
      return null;
    }

    return {
      schoolCount: schoolsRes.count ?? 0,
      userCount: usersRes.count ?? 0,
      aralCount: aralRes.count ?? 0,
      recentSchools: (recentRes.data ?? []) as RecentSchool[],
      dbAvailable: true,
      source: "postgrest",
    };
  } catch {
    return null;
  }
}

export async function loadAdminDashboardStats(): Promise<AdminDashboardStats> {
  try {
    const [schoolCount, userCount, aralCount, recentSchools] = await Promise.all([
      prisma.school.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.learner.count({ where: { isAralLearner: true, deletedAt: null } }),
      prisma.school.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, schoolIdCode: true },
      }),
    ]);
    return {
      schoolCount,
      userCount,
      aralCount,
      recentSchools,
      dbAvailable: true,
      source: "prisma",
    };
  } catch (err) {
    if (!isPrismaConnectionError(err)) throw err;
  }

  const viaRest = await loadDashboardViaPostgrest();
  if (viaRest) return viaRest;

  return {
    schoolCount: 0,
    userCount: 0,
    aralCount: 0,
    recentSchools: [],
    dbAvailable: false,
    source: "none",
  };
}

async function loadSchoolsViaPostgrest(): Promise<SchoolListRow[] | null> {
  if (!getSupabaseServiceEnv().ok) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("School")
      .select("id, name, schoolIdCode, region, division, isActive")
      .is("deletedAt", null)
      .order("createdAt", { ascending: false });

    if (error || !data) return null;

    // Count related rows per school (two lightweight queries)
    const [{ data: users }, { data: learners }] = await Promise.all([
      admin.from("User").select("schoolId").is("deletedAt", null).not("schoolId", "is", null),
      admin.from("Learner").select("schoolId").is("deletedAt", null),
    ]);

    const userCounts = new Map<string, number>();
    for (const row of users ?? []) {
      const sid = row.schoolId as string;
      userCounts.set(sid, (userCounts.get(sid) ?? 0) + 1);
    }
    const learnerCounts = new Map<string, number>();
    for (const row of learners ?? []) {
      const sid = row.schoolId as string;
      learnerCounts.set(sid, (learnerCounts.get(sid) ?? 0) + 1);
    }

    return data.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      schoolIdCode: s.schoolIdCode as string,
      region: (s.region as string | null) ?? null,
      division: (s.division as string | null) ?? null,
      isActive: Boolean(s.isActive),
      users: userCounts.get(s.id as string) ?? 0,
      learners: learnerCounts.get(s.id as string) ?? 0,
    }));
  } catch {
    return null;
  }
}

export async function loadAdminSchoolsList(): Promise<{
  schools: SchoolListRow[];
  dbAvailable: boolean;
  source: "prisma" | "postgrest" | "none";
}> {
  try {
    const schools = await prisma.school.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        schoolIdCode: true,
        region: true,
        division: true,
        isActive: true,
        _count: { select: { users: true, learners: true } },
      },
    });
    return {
      schools: schools.map((s) => ({
        id: s.id,
        name: s.name,
        schoolIdCode: s.schoolIdCode,
        region: s.region,
        division: s.division,
        isActive: s.isActive,
        users: s._count.users,
        learners: s._count.learners,
      })),
      dbAvailable: true,
      source: "prisma",
    };
  } catch (err) {
    if (!isPrismaConnectionError(err)) throw err;
  }

  const viaRest = await loadSchoolsViaPostgrest();
  if (viaRest) {
    return { schools: viaRest, dbAvailable: true, source: "postgrest" };
  }

  return { schools: [], dbAvailable: false, source: "none" };
}
