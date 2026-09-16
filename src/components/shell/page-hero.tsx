import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * v2 page banner: a rounded band of soft art with the page's text over its
 * left half, and the character's head rising past the band's top edge.
 *
 * Every v2 banner PNG shares one geometry — 2172×579, with a transparent top
 * strip (rows 0–46) that only the character's head reaches into. The band,
 * rows 47–578 (532px), fills the section exactly, so the image is drawn at
 * 579/532 = 108.83% of the section's height, bottom- and right-anchored.
 *
 * Two layers of the same image make the head "pop out":
 *  1. the band, clipped by a rounded, overflow-hidden box;
 *  2. a strip 47/532 = 8.83% tall sitting directly above the section,
 *     showing only the image's top rows — the head rising past the edge.
 * Both layers anchor to the same right edge at the same height, so they line
 * up pixel for pixel.
 *
 * Below lg the hero is a fixed 15rem, so the art is exactly 261px tall and
 * 980px wide, and the caller places it by the character (`artClassName`)
 * rather than by a percentage that drifts with width. `phoneMaskClassName`
 * lets a page hide the part of the art that collides with its text on the
 * narrowest phones.
 *
 * From lg the art is zoomed 1.25× to make the character bigger without
 * changing the section's size: it is drawn at 108.83% × 1.25 = 136.04% and
 * top-anchored at -8.83%, so the head still rises exactly as far above the
 * band as before and the extra height is cropped off the bottom (clouds,
 * already under the cards that overlap the hero). The head strip stays 8.83%
 * tall, so its image is 136.04 / 8.83 = 1540.7% of the strip. Wide screens
 * fade the art's left edge into the band.
 */
export function PageHero({
  bannerSrc,
  artClassName,
  phoneMaskClassName,
  headClassName,
  className,
  contentClassName,
  topRight,
  children,
}: {
  bannerSrc: string;
  /** Right offset of the art below lg, e.g. `right-[calc(23%-272px)]`. */
  artClassName: string;
  /** `max-[439px]:[&>img]:[mask-image:…]` style classes for layer 1. */
  phoneMaskClassName?: string;
  /** Extra classes for the head strip, e.g. `max-lg:hidden` when the phone art sits inside the band. */
  headClassName?: string;
  className?: string;
  contentClassName?: string;
  /**
   * A control floated in the hero's top-right corner, over the art — e.g. the
   * advisory scope switcher. Wrapped in its own tinted, ringed surface so it
   * stays legible over the illustration; sized down and re-anchored on the
   * narrowest phones so it never overlaps the title.
   */
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const art = (
    <Image
      src={bannerSrc}
      alt=""
      aria-hidden
      width={2172}
      height={579}
      priority
      sizes="(min-width: 1024px) 80vw, 250vw"
      className={cn(
        "absolute top-auto h-[108.83%] w-auto max-w-none lg:right-0",
        artClassName
      )}
    />
  );

  // mt-2, not more: the head strip rises ~8.8% of the band above the
  // section, and the page padding above already gives it room.
  return (
    <section className={cn("relative isolate mt-2 h-[15rem] lg:h-auto", className)}>
      {/* Layer 1: the band. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-sky-50 to-violet-100/60 dark:from-card dark:via-card dark:to-card [&>img]:bottom-0 lg:[&>img]:bottom-auto lg:[&>img]:top-[-8.83%] lg:[&>img]:h-[136.04%] lg:[&>img]:[mask-image:linear-gradient(to_right,transparent,black_22%)] dark:[&>img]:opacity-80",
          phoneMaskClassName
        )}
      >
        {art}
      </div>
      {/* Layer 2: the head, above the band's top edge. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-full h-[8.83%] overflow-hidden [&>img]:top-0 [&>img]:h-[1232.5%] lg:[&>img]:h-[1540.7%] dark:[&>img]:opacity-80",
          headClassName
        )}
      >
        {art}
      </div>
      <div
        className={cn(
          "flex h-full flex-col justify-center px-5 py-6 lg:min-h-[19rem] lg:px-8 lg:py-6",
          contentClassName
        )}
      >
        {children}
      </div>
      {topRight ? (
        <div className="absolute right-3 top-3 z-20 sm:right-4 sm:top-4 lg:right-6 lg:top-6">
          <div className="rounded-xl border border-border/70 bg-card/95 p-1 shadow-card backdrop-blur-sm sm:rounded-2xl">
            {topRight}
          </div>
        </div>
      ) : null}
    </section>
  );
}
