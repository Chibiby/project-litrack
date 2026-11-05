/**
 * Shakes every field that is marked invalid inside `root`, so a failed sign-in
 * points at what needs fixing instead of only printing a line of red text.
 *
 * A field is anything with `aria-invalid="true"`; when it sits in a wrapper
 * marked `data-shake`, the wrapper moves instead, so a field's icon and
 * floating label travel with it. Uses the Web Animations API, so the same field
 * shakes again on every attempt without re-rendering anything. Nothing moves
 * when the user asked for reduced motion.
 */
export const SHAKE_KEYFRAMES: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-8px)" },
  { transform: "translateX(7px)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(3px)" },
  { transform: "translateX(0)" },
];

export const SHAKE_TIMING: KeyframeAnimationOptions = {
  duration: 380,
  easing: "ease-in-out",
};

/** Returns how many fields were shaken (0 under reduced motion). */
export function shakeInvalidFields(root: ParentNode | null | undefined): number {
  if (!root || typeof window === "undefined") return 0;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;

  const targets = new Set<Element>();
  root.querySelectorAll('[aria-invalid="true"]').forEach((field) => {
    targets.add(field.closest("[data-shake]") ?? field);
  });
  targets.forEach((target) => {
    if (typeof (target as HTMLElement).animate === "function") {
      (target as HTMLElement).animate(SHAKE_KEYFRAMES, SHAKE_TIMING);
    }
  });
  return targets.size;
}
