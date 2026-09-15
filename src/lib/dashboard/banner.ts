/** Dashboard hero art. Anything but MALE — including unset — gets the female art. */
export function teacherBannerSrc(gender: "MALE" | "FEMALE" | null | undefined): string {
  return gender === "MALE"
    ? "/brand/banner-teacher-male.png"
    : "/brand/banner-teacher-female.png";
}
