/*
 * Direction contract — LITRACK sign-in (/login, /admin/login), storybook world.
 * THESIS: signing in feels like opening a friendly picture book from school,
 *   not a printed module cover — bright, rounded, chunky, still plainly a
 *   teachers' tool underneath.
 * OWN-WORLD: the ARAL logo colors used lighter and more generously — pale sky
 *   and pale sunshine tints behind bright blue, navy, and sun gold; Baloo 2
 *   rounded display type for LITRACK, headings, and the Continue button;
 *   chunky rounded shapes with solid navy "stacked book" offset shadows
 *   instead of glows; the school learners set in an arch window over the
 *   school illustration; a sun doodle and a red hand-drawn squiggle as the
 *   only decorative marks.
 * STORY: a teacher opens the book, finds their school, picks how they sign
 *   in, and continues, knowing at each step where they are.
 * FIRST VIEWPORT: logo masthead; the sky-lit title with its squiggle; the
 *   school art with the learners' arch window; the sign-in card riding near
 *   the top, its gold Continue the one live action.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with
 *   the finish review, the verdict, and every shipping asset carrying its
 *   provenance.
 */
import Image from "next/image";
import { Baloo_2 } from "next/font/google";
import { cn } from "@/lib/utils";
import { SunDoodle, Squiggle } from "@/components/auth/story-doodles";

/**
 * Display lettering for LITRACK, headings, the role tiles and Continue. Loaded here,
 * not in the root layout, so only the sign-in screens pay for it.
 */
const storyFace = Baloo_2({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-story",
  display: "swap",
});

/** Page gutter, shared by the masthead, the stage, and the footer. */
const GUTTER = "px-4 sm:px-6 lg:px-10 xl:px-16 2xl:px-24";

/**
 * The sign-in screens' frame: a storybook opening on the school. A paper
 * masthead with the program and partner marks, a sky-and-sunshine stage with
 * the school illustration and the LITRACK title, and the sign-in card set
 * near the top — beside the title at lg, below the title art on phones.
 *
 * One DOM tree throughout: `children` (the sign-in form), the title, and the
 * footer each render exactly once. Only CSS (grid-cols-1 → lg:grid-cols-[…],
 * absolute vs. static, responsive sizing) changes the layout between phone
 * and desktop — there is no parallel phone/desktop copy of the form to lose
 * state or double up ids when the viewport crosses the `lg` breakpoint.
 *
 * Always light (ALWAYS_LIGHT_PATHS in @/lib/theme): the storybook does not
 * change with the room, so the inks here are fixed rather than theme tokens.
 * `--primary` and `--ring` are re-pointed at the ARAL blue so shared controls
 * (focus rings, selection) match.
 */
export function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      className={cn(
        storyFace.variable,
        "flex min-h-dvh flex-col bg-aral-sky text-aral-navy caret-aral-blue [--primary:213_98%_27%] [--ring:213_98%_27%]"
      )}
    >
      <Masthead />

      <div
        className={cn(
          GUTTER,
          "relative flex-1 grid content-start grid-cols-1 lg:grid-cols-[minmax(0,1fr)_30rem] lg:gap-10 lg:pb-12 lg:pt-10"
        )}
      >
        {/* The school illustration backdrop: a strip behind the title on
            phones, the full stage behind both columns at lg. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-56 overflow-hidden sm:h-64 lg:inset-0 lg:h-auto"
        >
          <Image
            src="/brand/login-bg.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[50%_20%] lg:object-[45%_30%]"
          />
        </div>

        {/* Title column: a phone-height art strip holding the title panel
            and the small arch window; in flow at lg, with the big title
            panel and the arch window stacked underneath it. */}
        <div className="relative z-10 col-start-1 row-start-1 h-56 pt-6 sm:h-64 lg:h-auto lg:pt-6 xl:pt-10">
          <div className="max-w-[62%] rounded-3xl border-2 border-aral-cloud bg-aral-paper/90 px-4 py-3 lg:max-w-xl lg:rounded-[28px] lg:px-8 lg:py-7">
            <Squiggle className="mb-1 h-3 w-16 lg:mb-2 lg:h-4 lg:w-40" />
            <h1 className="font-story text-[clamp(2rem,10vw,2.75rem)] font-extrabold leading-[0.9] tracking-[-0.01em] text-aral-navy lg:text-[clamp(3.5rem,6.5vw,6.5rem)] lg:leading-[0.88] lg:tracking-[-0.02em]">
              LITRACK
            </h1>
            <p className="mt-2 text-balance text-sm font-semibold leading-snug text-aral-navy lg:mt-4 lg:text-xl">
              School reading-profiling system for the ARAL Program
            </p>
            <p className="mt-4 hidden text-lg leading-relaxed text-aral-navy/80 lg:block">
              Track progress. Empower teachers. Support every learner. Together, we build a more
              literate Philippines.
            </p>
          </div>

          {/* The learners' window: anchored bottom-right of the strip on
              phones (its bottom edge kept above the card's -mt-8 overlap
              zone), in normal flow under the title panel at lg. */}
          <div className="absolute bottom-10 right-0 h-24 w-28 sm:bottom-12 sm:h-28 sm:w-32 lg:static lg:mt-10 lg:h-[13rem] lg:w-[16.5rem] xl:h-[15rem] xl:w-[19rem]">
            <ArchWindow />
          </div>
        </div>

        {/* Card column: overlaps up into the strip on phones, sits beside
            the title at lg. */}
        <div className="relative z-10 col-start-1 row-start-2 -mt-8 pb-10 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:pb-0 lg:pt-6">
          {children}
        </div>
      </div>

      <Footer />
    </main>
  );
}

/** The learners, set inside a rounded arch window with a sun doodle at its shoulder. */
function ArchWindow() {
  return (
    <div className="relative size-full">
      <div className="relative size-full overflow-hidden rounded-t-full rounded-b-3xl border-4 border-aral-paper bg-aral-sky shadow-[0_6px_0_0_#12294D]">
        <Image
          src="/brand/login-learners.webp"
          alt=""
          fill
          sizes="(min-width: 1024px) 320px, 160px"
          className="object-cover object-[50%_85%]"
        />
      </div>
      {/* Phones already show a sun doodle in the card header; keep this one
          desktop-only so no more than two doodles are visible on a phone at
          once. Tucked onto the arch's curve at its top-right shoulder (15%
          in from each side of the box). */}
      <SunDoodle className="absolute right-[15%] top-[15%] hidden size-12 -translate-y-1/2 translate-x-1/2 lg:block" />
    </div>
  );
}

function Footer() {
  return (
    <div
      className={cn(
        GUTTER,
        "bg-aral-navy py-3 text-center font-story text-sm font-semibold leading-snug text-aral-paper sm:text-base lg:text-left"
      )}
    >
      {/* Phones set the credit as two deliberate lines rather than a ragged wrap. */}
      <span>
        Department of Education
        <span className="hidden sm:inline"> &middot; </span>
        <br className="sm:hidden" />
        Division of Sarangani
      </span>
    </div>
  );
}

function Masthead() {
  return (
    <header
      className={cn(
        GUTTER,
        "flex items-center justify-between gap-4 border-b-2 border-aral-cloud bg-aral-paper py-3"
      )}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <Image
          src="/logo.png"
          alt="ARAL Program logo"
          width={384}
          height={512}
          priority
          sizes="(min-width: 1024px) 64px, 56px"
          className="h-12 w-auto sm:h-14 lg:h-16"
        />
        <span aria-hidden className="h-9 w-px bg-aral-line sm:h-10 lg:h-12" />
        <Image
          src="/partner-logos.png"
          alt="Partner organizations: DepEd, Bagong Pilipinas, and Division of Sarangani"
          width={1024}
          height={312}
          priority
          sizes="(min-width: 1024px) 208px, (min-width: 640px) 160px, 128px"
          className="h-auto w-32 sm:w-40 lg:w-52"
        />
      </div>
    </header>
  );
}
