/*
 * Direction contract — LITRACK sign-in (/login, /admin/login), seed f3e333bb.
 * THESIS: signing in opens your school's module: a printed DepEd Self-Learning
 *   Module cover in ARAL ink, refusing the glass card floating over a photo.
 * OWN-WORLD: flat offset inks from the ARAL logo, royal blue #013E88 title
 *   band, navy #12294D type and label header, sun gold #FED110 only on the one
 *   live control, a red-navy-gold rule (the A-R-A letters) as the single ARAL-letter moment; white
 *   stock, square-ish corners, Archivo expanded black for cover lettering.
 * STORY: a teacher recognises the module cover, finds their school, picks how
 *   they sign in, and continues, knowing at each step where they are.
 * FIRST VIEWPORT: logo masthead; the blue band with LITRACK; the school art as
 *   cover picture; the sign-in label box set into the cover at right (below on
 *   phones), its gold Continue the primary action.
 * FORM: The Self-Learning Module Cover, index 5 of 7 grounded; seed f3e333bb.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, DESIGN.md, and every shipping raster carrying
 *   its provenance
 */
import Image from "next/image";
import { Archivo } from "next/font/google";
import { cn } from "@/lib/utils";

/**
 * Cover lettering. DepEd module covers set their titles in a heavy grotesque;
 * Archivo's width axis gives that printed weight without a system display face.
 * Loaded here, not in the root layout, so only the sign-in screens pay for it.
 */
const moduleFace = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-module",
  display: "swap",
});

/** Page gutter, shared by the masthead, the title band and the label column. */
const GUTTER = "px-4 sm:px-6 lg:px-10 xl:px-16 2xl:px-24";

/**
 * The sign-in screens' frame: a DepEd Self-Learning Module cover. A white
 * masthead with the program and partner marks, the royal-blue title band, the
 * school illustration as the cover picture, and the page's label box set into
 * the cover — beside the title on desktop, below the picture on phones.
 *
 * Always light (ALWAYS_LIGHT_PATHS in @/lib/theme): printed stock does not
 * change with the room, so the inks here are fixed rather than theme tokens.
 * `--primary` and `--ring` are re-pointed at the royal blue so shared controls
 * (focus rings, selection) print in the same ink.
 */
export function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      className={cn(
        moduleFace.variable,
        "flex min-h-dvh flex-col bg-aral-paper text-aral-navy caret-aral-blue [--primary:213_98%_27%] [--ring:213_98%_27%]"
      )}
    >
      <Masthead />

      {/*
       * Grid cell map (phone stack vs desktop overlay):
       * - band fill (row 1, col 1, spans both cols at lg): stacked behind CoverTitle on phones,
       *   the title band across the full masthead width on desktop.
       * - ARAL-letter rule (row 1, col 1 only): full-width on phones (single column); at lg it
       *   stays inside column 1 so it ends where the label column begins.
       * - CoverTitle (row 1, col 1): the LITRACK title, stacked on the band on phones and desktop.
       * - art strip (row 2, col 1, spans both cols at lg): the school photo; full width under the
       *   title on phones, the full cover picture behind the label box on desktop.
       * - label box (row 3 on phones; lg: col 2, spans rows 1-2): below the art on phones, set
       *   into the cover at the right on desktop.
       * - cover foot (row 4 on phones; lg: row 3, spans both cols): the closing navy strip, below
       *   the label box on phones since it stacks after it in document order, a full-width row
       *   under the picture and label box on desktop.
       */}
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[auto_minmax(15rem,1fr)_auto]">
        {/* The band's ink runs the full width behind the title and the top of
            the label box. The ARAL-letter rule stacks in the same cell but stays
            inside column 1 at lg, so it does not run under the label box. */}
        <div aria-hidden className="col-start-1 row-start-1 bg-aral-blue lg:col-[1/3]" />
        <div aria-hidden className="col-start-1 row-start-1 flex h-1.5 self-end lg:h-2.5">
          <span className="flex-1 bg-aral-red" />
          <span className="flex-1 bg-aral-navy" />
          <span className="flex-1 bg-aral-gold" />
        </div>

        <CoverTitle />

        <div className="relative col-start-1 row-start-2 h-52 sm:h-60 lg:col-[1/3] lg:h-auto">
          <Image
            src="/brand/login-bg.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[43%_50%] lg:object-[45%_72%]"
          />
        </div>

        <div
          className={cn(
            GUTTER,
            "relative z-10 col-start-1 row-start-3 -mt-8 pb-10 sm:-mt-10",
            "lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-10 lg:self-start lg:pl-0"
          )}
        >
          {children}
        </div>

        <CoverFoot />
      </div>
    </main>
  );
}

function CoverFoot() {
  return (
    <div
      className={cn(
        GUTTER,
        "row-start-4 bg-aral-navy py-3 text-center text-xs font-semibold uppercase leading-snug tracking-[0.08em] text-aral-paper [font-stretch:112%] sm:text-sm lg:col-[1/3] lg:row-start-3 lg:text-left"
      )}
    >
      {/* Phones set the credit as two deliberate lines rather than a ragged wrap. */}
      <span className="font-module">
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
    <header className={cn(GUTTER, "flex items-center justify-between gap-4 py-3")}>
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

function CoverTitle() {
  return (
    <div
      className={cn(
        GUTTER,
        "relative col-start-1 row-start-1 pb-8 pt-7 sm:pb-10 sm:pt-9 lg:pb-14 lg:pr-12 lg:pt-12 xl:pt-16"
      )}
    >
      <h1 className="font-module text-[clamp(3.25rem,6.6vw,7.25rem)] font-black leading-[0.88] tracking-[-0.02em] text-aral-paper [font-stretch:112%]">
        LITRACK
      </h1>
      <p className="mt-3 max-w-[30ch] text-balance text-base font-semibold leading-snug text-aral-paper sm:text-lg lg:mt-5 lg:text-2xl">
        School reading-profiling system for the ARAL Program
      </p>
      <p className="mt-3 hidden max-w-[52ch] text-base leading-relaxed text-[#C9DAF2] sm:block lg:text-lg">
        Track progress. Empower teachers. Support every learner. Together, we build a more
        literate Philippines.
      </p>
    </div>
  );
}
