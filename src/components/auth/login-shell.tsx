import Image from "next/image";

/**
 * The sign-in screens' frame (owner mockup, 2026-09-15): the school
 * illustration fills the screen, the ARAL and partner logos sit over the
 * LITRACK wordmark, and the page's card goes beside it on desktop or under it
 * on phones.
 *
 * Always light — see ALWAYS_LIGHT_PATHS in @/lib/theme — so the colours here
 * are fixed rather than theme tokens: the art is daytime either way.
 */
export function LoginShell({
  children,
  glass = false,
}: {
  children: React.ReactNode;
  /** Frosted-glass sign-in card (see AuthCard's `.login-glass` styles). */
  glass?: boolean;
}) {
  return (
    <main
      id="main-content"
      className={`relative isolate min-h-dvh overflow-x-hidden bg-info-100${glass ? " login-glass" : ""}`}
    >
      {/* The art is drawn 12% taller than the screen and pinned to the top,
          which drops the building to about two thirds down (the mockup) and
          keeps the wordmark and tagline in the sky; the extra pavement falls
          off the bottom.
          Desktop: fixed to the viewport. Below that the page scrolls, so the
          art scrolls with it instead: the glass card (LiquidGlassLayer) holds
          a refracted copy of this art, and a fixed backdrop under a moving
          card would force that copy to be realigned and redrawn on every
          scroll frame, a frame behind the scroll. Sized in svh (the height
          with the browser bar shown), which does not change as the bar
          slides away, so the art never zooms mid-scroll; it grows only when
          the page is taller than that. */}
      <div
        aria-hidden
        data-login-art=""
        className="absolute inset-x-0 top-0 -z-10 h-[max(112svh,100%)] overflow-hidden lg:fixed lg:inset-0 lg:h-auto"
      >
        <div className="absolute inset-0 lg:bottom-auto lg:h-[112%]">
          <Image
            src="/brand/login-bg.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[42%_top] lg:object-top"
          />
        </div>
        {/* A light wash under the text, strongest where the wordmark sits. */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/15 to-transparent lg:bg-gradient-to-r lg:from-white/55 lg:via-white/10 lg:to-transparent" />
      </div>

      <div className="mx-auto flex min-h-dvh w-full max-w-[96rem] flex-col items-center gap-6 px-4 py-8 sm:px-6 md:max-lg:justify-center md:max-lg:gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:px-10 xl:px-16 2xl:px-24">
        <LoginBrand />
        <div className="w-full max-w-md lg:max-w-[32rem] lg:shrink-0 2xl:max-w-[38rem]">
          {children}
        </div>
      </div>
    </main>
  );
}

function LoginBrand() {
  return (
    <section
      aria-label="LITRACK"
      className="flex w-full flex-col items-center text-center lg:max-w-2xl lg:items-start lg:self-start lg:pt-4 lg:text-left xl:max-w-[46rem]"
    >
      <div className="flex items-center gap-3 sm:gap-5">
        <Image
          src="/logo.webp"
          alt="ARAL Program logo"
          width={384}
          height={512}
          priority
          sizes="(min-width: 1024px) 128px, 80px"
          className="h-16 w-auto sm:h-24 lg:h-40"
        />
        <span aria-hidden className="h-11 w-px bg-muted-foreground/40 sm:h-16 lg:h-24" />
        <Image
          src="/partner-logos.webp"
          alt="Partner organizations: DepEd, Bagong Pilipinas, and Division of Sarangani"
          width={704}
          height={216}
          priority
          sizes="(min-width: 1024px) 352px, 220px"
          className="h-auto w-[9rem] sm:w-[14rem] lg:w-[22rem]"
        />
      </div>

      <h1 className="mt-5 text-[3.5rem] font-black leading-none tracking-tight sm:text-7xl lg:mt-14 lg:text-[6.5rem] xl:text-[7.5rem]">
        <span className="text-indigo-950">LIT</span>
        <span className="text-aral-600">RACK</span>
      </h1>
      <p className="mt-1 text-balance text-sm font-semibold text-slate-700 sm:text-base lg:mt-2 lg:text-xl xl:text-2xl">
        School reading-profiling system for the ARAL Program
      </p>
      <p className="mt-2 max-w-xl text-balance text-xs leading-relaxed text-slate-700 sm:text-sm lg:mt-6 lg:max-w-none lg:text-base xl:text-lg">
        Track progress. Empower teachers. Support every learner.{" "}
        <span className="lg:block">Together, we build a more literate Philippines.</span>
      </p>
    </section>
  );
}
