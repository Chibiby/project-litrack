import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  completeTeacherAuthAfterVerify,
  parseNamesFromUserMetadata,
  TEACHER_OAUTH_CTX_COOKIE,
  type TeacherAuthIntent,
  type TeacherOAuthCtx,
} from "@/lib/auth/teacher-registration";

function loginErrorRedirect(message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  );
}

function parseOAuthCtx(raw: string | undefined): TeacherOAuthCtx | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TeacherOAuthCtx;
    if (
      typeof parsed.schoolId === "string" &&
      (parsed.intent === "login" || parsed.intent === "register")
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=Google%20sign-in%20failed", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL("/login?error=Google%20sign-in%20failed", origin));
  }

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser?.email) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=Google%20sign-in%20failed", origin));
  }

  const email = authUser.email.toLowerCase().trim();
  const cookieStore = await cookies();
  const ctx = parseOAuthCtx(cookieStore.get(TEACHER_OAUTH_CTX_COOKIE)?.value);
  cookieStore.set(TEACHER_OAUTH_CTX_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  let intent: TeacherAuthIntent = ctx?.intent ?? "login";
  let schoolId = ctx?.schoolId;

  if (!schoolId) {
    intent = "login";
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { schoolId: true, role: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt || existing.role !== "TEACHER" || !existing.schoolId) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        new URL("/login?error=No%20account%20found.%20Create%20one%20first.", origin)
      );
    }
    schoolId = existing.schoolId;
  }

  const names = parseNamesFromUserMetadata(
    authUser.user_metadata as Record<string, unknown> | undefined,
    email
  );

  const result = await completeTeacherAuthAfterVerify({
    authId: authUser.id,
    email,
    schoolId,
    intent,
    names: intent === "register" ? names : undefined,
  });

  if (!result.ok) {
    if (result.signOut) {
      await supabase.auth.signOut();
    }
    return loginErrorRedirect(result.error);
  }

  const dest = result.outcome === "approved" ? "/teacher" : "/pending-approval";
  return NextResponse.redirect(new URL(dest, origin));
}
