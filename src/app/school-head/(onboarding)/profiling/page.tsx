import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { getSchoolStructureDefaults } from "@/lib/school-structure-defaults";
import { PageHero } from "@/components/shell/page-hero";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";

export const dynamic = "force-dynamic";

// Explicit select, `gender` deliberately excluded: the column's migration has
// not been applied everywhere yet (see the gender read below), and an
// unscoped `findUnique` would pull it in and take the whole profile query
// down with it.
const SCHOOL_HEAD_PROFILE_SELECT = {
  contactNumber: true,
  contactEmail: true,
  designation: true,
  position: true,
  educationalAttainment: true,
  fieldOfSpecialization: true,
  specializationOther: true,
  yearsInService: true,
  hasReadingTraining: true,
  readingTrainings: true,
  hasEnglishTraining: true,
  englishTrainings: true,
  highestTrainingLevel: true,
} as const;

export default async function SHProfilingPage() {
  const user = await requireUser("SCHOOL_HEAD");

  const [profile, gender, structure] = await Promise.all([
    prisma.schoolHeadProfile.findUnique({
      where: { userId: user.id },
      select: SCHOOL_HEAD_PROFILE_SELECT,
    }),
    // Hero art must never take the page down: any read failure (including a
    // database the gender migration has not reached yet) falls back to the
    // default banner. A first-run head has no stored profile at all, so this
    // resolves to the documented female fallback.
    prisma.schoolHeadProfile
      .findUnique({ where: { userId: user.id }, select: { gender: true } })
      .then((p) => p?.gender ?? null)
      .catch(() => null),
    user.schoolId
      ? getSchoolStructureDefaults(user.schoolId)
      : Promise.resolve({ gradeTypes: [], sectionsPerGrade: 1, existingGradeStats: [] }),
  ]);

  return (
    <div className="space-y-6">
      <PageHero
        bannerSrc={teacherBannerSrc(gender)}
        artClassName="right-[calc(18%-272px)] sm:right-[calc(23%-272px)]"
        phoneMaskClassName="max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_67%,black_72%)]"
        contentClassName="lg:min-h-[15rem]"
      >
        <h1 className="max-w-[11rem] text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:max-w-none sm:text-3xl lg:text-5xl">
          School Head Profiling
        </h1>
        <p className="mt-2 max-w-[11rem] text-sm leading-snug text-slate-600 dark:text-slate-300 sm:max-w-sm sm:text-base lg:max-w-md lg:text-lg lg:text-slate-800">
          Complete this profile to unlock the rest of the app
        </p>
      </PageHero>
      <SchoolHeadProfileForm
        defaultValues={{
          // Bootstrap placeholders from createSchool — blank so SH enters real name.
          firstName:
            user.firstName === "School" && user.lastName === "Head"
              ? ""
              : user.firstName,
          middleName: user.middleName ?? "",
          lastName:
            user.firstName === "School" && user.lastName === "Head"
              ? ""
              : user.lastName,
          ...(profile ?? {}),
          gender: gender ?? undefined,
          gradeTypes: structure.gradeTypes,
          sectionsPerGrade: structure.sectionsPerGrade,
          existingGradeStats: structure.existingGradeStats,
        }}
      />
    </div>
  );
}
