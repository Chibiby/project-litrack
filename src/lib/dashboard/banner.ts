/**
 * Dashboard hero art. Anything but MALE — including unset — gets the female art.
 * School Heads share this same art under the same gender rule (`SchoolHeadProfile.gender`) — see `docs/school-head-ui-rework.md` section 1.2.
 */
export function teacherBannerSrc(gender: "MALE" | "FEMALE" | null | undefined): string {
  return gender === "MALE"
    ? "/brand/banner-teacher-male.webp"
    : "/brand/banner-teacher-female.webp";
}
