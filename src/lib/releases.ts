/**
 * What version this app is, and what changed in each one.
 *
 * This file is the source of truth. `package.json` mirrors it and a test in
 * `tests/unit/releases.test.ts` fails if the two drift, because the version a
 * user is shown and the version npm reports must be the same string.
 *
 * Deliberately NOT `server-only`: the "what's new" modal is a client component
 * and reads the same array the server does. There is nothing here but committed
 * copy — no I/O, no secrets — so both sides sharing it is safe and keeps one
 * list rather than two that can disagree.
 *
 * Every push to main that changes `src/` or `prisma/` adds an entry here and
 * bumps `package.json` in the same push (CLAUDE.md § Releases; a PreToolUse hook
 * in `.claude/settings.json` blocks the push otherwise). No migration, no admin
 * screen, no separate CHANGELOG to fall out of date.
 *
 * Semver, as this project uses it:
 *   patch  (1.2.X) the push holds only fixes
 *   minor  (1.X.0) the push holds at least one feature
 *   major  (X.0.0) only when the project owner says so
 */
/**
 * Who a note is written for. Mirrors Prisma's `UserRole` by hand rather than
 * importing it: this module is shared with the client, and pulling
 * `@prisma/client` into it for three string literals would drag the generated
 * client into the browser bundle.
 */
export type ReleaseAudience = "SUPER_ADMIN" | "SCHOOL_HEAD" | "TEACHER";

/**
 * One line of "what changed".
 *
 * A bare string is for everybody — the default, and what nearly every note
 * should be. The object form restricts a note to the roles that can act on it,
 * and exists for one reason: a note can itself disclose something. "A Super
 * Admin can read back the password a School Head chose" tells every School Head
 * in the country that someone else can see the password they picked, which is a
 * privacy matter and not theirs to learn from a changelog. Restrict a note when
 * reading it would disclose a capability over the reader's own data; do not
 * restrict one merely because it is about a screen the reader cannot open.
 */
export type ReleaseNote =
  | string
  | { text: string; roles: readonly ReleaseAudience[] };

export type Release = {
  /** Semver, no leading "v". */
  version: string;
  /** `YYYY-MM-DD`. Local calendar date of the release, not a timestamp. */
  date: string;
  /** One line, sentence case. */
  title: string;
  /**
   * Whether to interrupt the user with the modal.
   *
   * Independent of the semver level on purpose. "Big revision" is an editorial
   * judgement, not an arithmetic one: a patch that changes what a teacher sees
   * on Monday may deserve the modal, and a minor that only touches the admin
   * console may not. Decided per release.
   */
  announce: boolean;
  /**
   * What changed, in the user's language, not the codebase's. Read through
   * `visibleFixes`, never directly — a restricted note must not reach a reader
   * it was not written for.
   */
  fixes: readonly ReleaseNote[];
  /**
   * A one-time welcome for a landmark release. When present, the update modal
   * becomes the welcome screen for every account that has not yet
   * acknowledged this version or a later one — see `welcomeRelease`.
   */
  welcome?: ReleaseWelcome;
};

/** Icon keys the welcome modal knows how to draw. Strings, so this module stays client-safe and icon-free. */
export type ReleaseHighlightIcon =
  | "profiling"
  | "reports"
  | "analytics"
  | "mobile"
  | "speed"
  | "workflow"
  | "dashboard"
  | "learners"
  | "aral"
  | "teachers"
  | "checklist"
  | "schools"
  | "help";

/** Tints the welcome cards use; the same families as the dashboard stat cards. */
export type ReleaseHighlightTone = "violet" | "emerald" | "blue" | "amber" | "rose" | "purple";

/** Languages the welcome can be read in. Patch notes stay English. */
export type WelcomeLocale = "en" | "fil";

export type LocalizedText = Readonly<Record<WelcomeLocale, string>>;

export type ReleaseHighlight = {
  icon: ReleaseHighlightIcon;
  tone: ReleaseHighlightTone;
  title: LocalizedText;
  body: LocalizedText;
  /** Same rule as a restricted `ReleaseNote`: omit for everybody. */
  roles?: readonly ReleaseAudience[];
};

/** One screen of the short tour behind "Let's Get Started". */
export type ReleaseGuideStep = {
  icon: ReleaseHighlightIcon;
  tone: ReleaseHighlightTone;
  title: LocalizedText;
  body: LocalizedText;
  /** The page "Show me" opens. Omit for a step that is not about one page. */
  href?: string;
  roles?: readonly ReleaseAudience[];
};

export type ReleaseWelcome = {
  /** Large line at the top of the modal. */
  headline: LocalizedText;
  /** One or two sentences under the headline. */
  intro: LocalizedText;
  highlightsTitle: LocalizedText;
  highlightsSubtitle: LocalizedText;
  highlights: readonly ReleaseHighlight[];
  guide: readonly ReleaseGuideStep[];
};

/**
 * Newest first. The order is load-bearing — `APP_VERSION` is the head, and a
 * test enforces strict descending order so it cannot quietly stop being true.
 */
export const RELEASES: readonly Release[] = [
  {
    version: "2.3.0",
    date: "2026-09-19",
    title: "A new School Head dashboard, and every School Head page redesigned",
    announce: true,
    fixes: [
      "Your dashboard has been rebuilt. It opens with a greeting and your school's figures as cards you can click straight through to, followed by how many learners are in ARAL, how many are Indigenous Peoples learners, and how this week's ARAL attendance is going. Charts and recent activity are still there, further down.",
      "A new panel gathers what needs you: teachers waiting for approval, sections with no adviser, and a school year that has not been set. The most urgent sits at the top, and each one is a link to the page where you fix it.",
      "Every School Head page now carries the same banner and layout as the teacher pages, so moving between them no longer feels like two different apps.",
      "The Audit page can now be searched by who did something or what they did, and narrowed to a date range. It also pages properly instead of stopping at the most recent hundred entries.",
      "Your profile now asks for your gender, which chooses the artwork on your dashboard and settings pages.",
      "The Teachers list no longer shows an empty page when you have no inactive teachers, and the Indigenous Peoples learners page now shows a loading screen instead of a blank one.",
      "Approving a teacher now updates the count on your dashboard straight away, instead of leaving the old number for up to a minute.",
      "The Teachers item in the sidebar now shows how many teachers are waiting for your approval, so you can see the queue without opening the page.",
    ],
  },
  {
    version: "2.2.1",
    date: "2026-09-17",
    title: "Clearer Grade 1 marks, and old advisories let go of their learners",
    announce: true,
    fixes: [
      "A learner you no longer advise now leaves your Learners list. Before, a section you were moved off kept its learners attached to you. If one of them still needs you as their ARAL tutor, ask your School Head to set that again.",
      "On the Grade 1 sheet, the empty choice now reads \"Unassigned\" instead of \"Clear\", each mark has its own colour, and a guide under the sheet spells out what A, B, C, D and E mean.",
      "The button that hides the Assistant on a phone now says \"Hide\", so it is clear what it does.",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-09-17",
    title: "Letter marks for Grade 1, and a way to tuck the Assistant away",
    announce: true,
    fixes: [
      "Grade 1 End of Terms grades are now picked from a list — A – Advancing, B – Benchmarking, C – Connecting, D – Developing, E – Emerging — instead of typed as numbers. Grade 1 sheets no longer show a General Average.",
      "A Grade 1 grade saved as a number before this update still shows on the sheet and in exports. Pick a letter for that learner to replace it.",
      "On a phone, the Assistant now has a Hide button. Hiding it leaves a small arrow tab at the edge of the screen; tap that to bring it back. Each account keeps its own choice on that phone, even after you log out and back in.",
    ],
  },
  {
    version: "2.1.1",
    date: "2026-09-17",
    title: "Password reset links open LITRACK again",
    announce: true,
    fixes: [
      "The link in a Forgot Password email now opens the LITRACK reset page. Before, it opened a page that could not be reached. If you already got a reset email, request a new one.",
    ],
  },
  {
    version: "2.1.0",
    date: "2026-09-17",
    title: "Choose which advisory a teacher keeps",
    announce: true,
    fixes: [
      { text: "Your Grades on the dashboard now counts only the grades you advise. Before, one ARAL learner from another grade made it show an extra grade.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "When you switch a multi-advisory teacher to One advisory section, you now pick which section they keep. Before, the first section in the list was kept without asking.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
    ],
  },
  {
    version: "2.0.2",
    date: "2026-09-17",
    title: "Student Profile tabs show on phones",
    announce: false,
    fixes: [
      "On phones, the Student Profile window shows its Profile, Attendance, Reading Level, Grades and ARAL Progress tabs again. Before, they were squeezed into a thin gray line.",
    ],
  },
  {
    version: "2.0.1",
    date: "2026-09-17",
    title: "ARAL menu links open the right page on phones",
    announce: false,
    fixes: [
      { text: "Weekly Attendance and Monthly Reading Level in the side menu now open their own pages, even when you have ARAL learners in more than one grade. Before, both opened the ARAL Program page.", roles: ["TEACHER", "SUPER_ADMIN"] },
      "The side menu on phones opens and closes faster, without the sliding highlight.",
    ],
  },
  {
    version: "2.0.0",
    date: "2026-09-17",
    title: "Welcome to LitRack v2",
    announce: true,
    welcome: {
      headline: {
        en: "Welcome to Litrack v2!",
        fil: "Maligayang pagdating sa Litrack v2!",
      },
      intro: {
        en: "A more modern, faster, and more complete learner profiling system — built to make teaching and learning management easier for you.",
        fil: "Isang mas moderno, mas mabilis, at mas kumpletong sistema ng learner profiling — nilikha upang gawing mas madali ang pagtuturo at pamamahala ng pagkatuto.",
      },
      highlightsTitle: {
        en: "What's New in Litrack v2",
        fil: "Mga Bago sa Litrack v2",
      },
      highlightsSubtitle: {
        en: "New features and improvements to give you a better experience.",
        fil: "Mga bagong feature at pagpapabuti para sa mas mahusay na paggamit.",
      },
      highlights: [
        {
          icon: "profiling",
          tone: "violet",
          title: {
            en: "Improved Learner Profiling",
            fil: "Pinahusay na Learner Profiling",
          },
          body: {
            en: "Easier and faster encoding with a cleaner, modern interface.",
            fil: "Mas madali at mas mabilis na pag-encode sa malinis at modernong anyo.",
          },
        },
        {
          icon: "reports",
          tone: "emerald",
          title: {
            en: "Enhanced Reports",
            fil: "Mas Mahusay na mga Ulat",
          },
          body: {
            en: "Generate End of Term Reports with updated formats and more options.",
            fil: "Gumawa ng End of Term Reports gamit ang bagong format at mas maraming pagpipilian.",
          },
        },
        {
          icon: "analytics",
          tone: "blue",
          title: {
            en: "Better Analytics",
            fil: "Mas Malinaw na Datos",
          },
          body: {
            en: "Visual insights to help you monitor learner progress.",
            fil: "Mga larawan at bilang na tumutulong sa pagsubaybay sa pag-unlad ng mga mag-aaral.",
          },
        },
        {
          icon: "mobile",
          tone: "amber",
          title: {
            en: "Mobile Friendly",
            fil: "Madaling Gamitin sa Phone",
          },
          body: {
            en: "Access key features anytime, anywhere.",
            fil: "Buksan ang mahahalagang bahagi anumang oras, saanman.",
          },
        },
        {
          icon: "speed",
          tone: "rose",
          title: {
            en: "Instant Updates",
            fil: "Agad na Pagbabago",
          },
          body: {
            en: "What you save, archive or delete shows up right away.",
            fil: "Ang iyong sine-save, ina-archive o binubura ay agad na makikita.",
          },
        },
        {
          icon: "workflow",
          tone: "purple",
          title: {
            en: "Streamlined Workflow",
            fil: "Mas Maayos na Daloy ng Gawain",
          },
          body: {
            en: "A smoother and more organized experience for teachers and school heads.",
            fil: "Mas maayos at organisadong paggamit para sa mga guro at school head.",
          },
        },
      ],
      guide: [
        {
          icon: "dashboard",
          tone: "violet",
          title: {
            en: "Start at your Dashboard",
            fil: "Magsimula sa iyong Dashboard",
          },
          body: {
            en: "See your grades, learners, ARAL learners and pending profiles at a glance. Each card opens the page behind it.",
            fil: "Tingnan sa isang sulyap ang iyong mga baitang, mag-aaral, ARAL learners at mga profile na hindi pa kumpleto. Bawat card ay nagbubukas ng pahina nito.",
          },
          href: "/teacher",
          roles: ["TEACHER"],
        },
        {
          icon: "learners",
          tone: "blue",
          title: {
            en: "Find any learner",
            fil: "Hanapin ang anumang mag-aaral",
          },
          body: {
            en: "On Learners, switch advisories from the banner, filter by grade, section, gender or ARAL status, and open a learner's menu to view, enroll in ARAL or archive.",
            fil: "Sa Learners, pumili ng advisory sa banner, i-filter ayon sa baitang, seksyon, kasarian o ARAL status, at buksan ang menu ng mag-aaral upang tingnan, i-enroll sa ARAL o i-archive.",
          },
          href: "/teacher/learners",
          roles: ["TEACHER"],
        },
        {
          icon: "aral",
          tone: "emerald",
          title: {
            en: "Run the ARAL Program",
            fil: "Isagawa ang ARAL Program",
          },
          body: {
            en: "Under ARAL Program in the side menu: record Weekly Attendance, enter the Monthly Reading Level, and complete ARAL Profiling for each learner you tutor.",
            fil: "Sa ARAL Program sa side menu: itala ang Weekly Attendance, ilagay ang Monthly Reading Level, at kumpletuhin ang ARAL Profiling ng bawat mag-aaral na iyong tinuturuan.",
          },
          href: "/teacher/aral",
          roles: ["TEACHER"],
        },
        {
          icon: "reports",
          tone: "amber",
          title: {
            en: "Finish the term",
            fil: "Tapusin ang markahan",
          },
          body: {
            en: "End of Terms Reports opens on your advisory. Kindergarten advisers rate the competency checklist instead, and both can be exported or printed.",
            fil: "Ang End of Terms Reports ay bubukas sa iyong advisory. Ang mga Kindergarten adviser ay magmamarka sa competency checklist, at parehong maaaring i-export o i-print.",
          },
          href: "/teacher/terms-reports",
          roles: ["TEACHER"],
        },
        {
          icon: "dashboard",
          tone: "violet",
          title: {
            en: "Start at your Dashboard",
            fil: "Magsimula sa iyong Dashboard",
          },
          body: {
            en: "Your school's learners, teachers and ARAL progress at a glance.",
            fil: "Ang mga mag-aaral, guro at ARAL progress ng iyong paaralan sa isang sulyap.",
          },
          href: "/school-head",
          roles: ["SCHOOL_HEAD"],
        },
        {
          icon: "teachers",
          tone: "blue",
          title: {
            en: "Manage your teachers",
            fil: "Pamahalaan ang iyong mga guro",
          },
          body: {
            en: "Approve new teachers, set their advisories and roles, and see changes the moment you save them.",
            fil: "Aprubahan ang mga bagong guro, itakda ang kanilang advisory at role, at makita ang pagbabago sa sandaling i-save.",
          },
          href: "/school-head/teachers",
          roles: ["SCHOOL_HEAD"],
        },
        {
          icon: "checklist",
          tone: "emerald",
          title: {
            en: "Review Kindergarten checklists",
            fil: "Suriin ang Kindergarten checklist",
          },
          body: {
            en: "Open Kindergarten Checklist to view each learner's competency ratings, then export or print them.",
            fil: "Buksan ang Kindergarten Checklist upang tingnan ang marka ng bawat mag-aaral sa bawat competency, at i-export o i-print ang mga ito.",
          },
          href: "/school-head/terms-reports/kinder",
          roles: ["SCHOOL_HEAD"],
        },
        {
          icon: "schools",
          tone: "violet",
          title: {
            en: "Oversee every school",
            fil: "Subaybayan ang bawat paaralan",
          },
          body: {
            en: "Schools, accounts, submissions and audit logs are where they were. Open a school to see it as its School Head does.",
            fil: "Ang mga paaralan, account, submission at audit log ay nasa dating lugar. Buksan ang isang paaralan upang makita ito gaya ng School Head.",
          },
          href: "/admin/schools",
          roles: ["SUPER_ADMIN"],
        },
        {
          icon: "reports",
          tone: "emerald",
          title: {
            en: "Keep term subjects in step",
            fil: "Panatilihing magkatugma ang mga subject",
          },
          body: {
            en: "Default Term Subjects can now reset every school's End of Terms subjects in one step.",
            fil: "Sa Default Term Subjects, maaari nang ibalik sa default ang End of Terms subjects ng bawat paaralan sa isang hakbang.",
          },
          href: "/admin/term-subjects",
          roles: ["SUPER_ADMIN"],
        },
        {
          icon: "help",
          tone: "amber",
          title: {
            en: "Help is always nearby",
            fil: "Ang tulong ay laging malapit",
          },
          body: {
            en: "Ask the assistant in the corner when you are stuck. These notes stay under Updates in the bell, and every release is listed on the changelog.",
            fil: "Magtanong sa assistant sa sulok kung kailangan ng tulong. Ang mga tala ay nasa Updates ng bell, at ang bawat release ay nakalista sa changelog.",
          },
        },
      ],
    },
    fixes: [
      { text: "New teacher dashboard: a greeting banner, cards for your grades, learners, ARAL learners and pending profiles, attendance and reading summaries, a calendar, and a daily quote.", roles: ["TEACHER", "SUPER_ADMIN"] },
      "New side menu and header. The highlight slides to the page you open, and the account menu works on phones.",
      { text: "Learners page: a banner, colored summary cards, an advisory switcher, every filter in one bar, a menu on each row, and a list made for phones.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "Archiving or restoring a learner removes them from the list the moment you click. If it fails, they come back and you are told why.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "Weekly Attendance shows the week's totals up front, and the grade and section pickers sit together under the banner.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "Monthly Reading Level shows five summary cards and a Reading Level Guide that uses the same colors as the grid.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "ARAL Profiling has a new banner, four summary cards, and a list made for phones.", roles: ["TEACHER", "SUPER_ADMIN"] },
      "End-of-Term Reports use one advisory picker, placed in the banner.",
      "Kindergarten's End-of-Term report is now the DepEd competency checklist: 62 competencies rated BG, DV or CO for each term. Teachers fill it in, School Heads can view it, and both can export it to Excel or print it.",
      { text: "The side menu now highlights the right page when you open a learner's ARAL profile, attendance or reading level.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "Profile Settings have a new layout with a summary of how complete your profile is. You can add your gender, which picks your dashboard picture.", roles: ["TEACHER", "SUPER_ADMIN"] },
      "A new sign-in screen.",
      "A welcome screen introduces LitRack v2 once, with a short tour of where things are. Read it in English or Filipino, and open any page straight from the tour.",
      "When you save, archive or delete something, the page shows the change right away instead of up to a minute later.",
      { text: "A Super Admin can reset every school's End-of-Term subjects to the defaults in one step.", roles: ["SUPER_ADMIN"] },
    ],
  },
  {
    version: "1.19.1",
    date: "2026-09-15",
    title: "Pages load faster",
    announce: false,
    fixes: [
      "Pages open faster, especially dashboards. LITRACK now runs closer to its database and remembers dashboard totals for a short time instead of counting them again on every visit.",
    ],
  },
  {
    version: "1.19.0",
    date: "2026-09-15",
    title: "ARAL Profiling is back as its own page",
    announce: true,
    fixes: [
      { text: "ARAL Profiling is back in the side menu under ARAL Program. It lists your ARAL learners, shows whose profile is still pending, and has a Complete profile or Update profile button for each one.", roles: ["TEACHER", "SUPER_ADMIN"] },
      { text: "On your dashboard, the Pending Profiles card now opens ARAL Profiling on the learners who still need a profile.", roles: ["TEACHER", "SUPER_ADMIN"] },
      "The ARAL profile no longer asks how often a learner is absent or why. Weekly Attendance already records absences, so they are not counted twice. Answers saved before are kept.",
    ],
  },
  {
    version: "1.18.3",
    date: "2026-09-15",
    title: "Kindergarten gets the Grade 1 subject list",
    announce: false,
    fixes: [
      "The default End of Terms subjects for Kindergarten are now the same as Grade 1: Reading and Literacy, Language, Makabansa, GMRC and Math. A school gets them when a School Head presses Reset to default.",
    ],
  },
  {
    version: "1.18.2",
    date: "2026-09-15",
    title: "Default End of Terms subjects can be edited again",
    announce: true,
    fixes: [
      { text: "On Default Term Subjects, Add subject, Restore and the move up/down arrows work again. Before, they failed with an error.", roles: ["SUPER_ADMIN"] },
      "The default End of Terms subjects for Grades 1 to 10 now follow the new lists. Grade 1: Reading and Literacy, Language, Makabansa, GMRC and Math. Grade 2: English, Filipino, Math, GMRC and Makabansa. Grade 3 adds Science. Grades 4 to 10: Math, Science, English, Filipino, MAPEH, Araling Panlipunan, TLE and GMRC. A school gets them when a School Head presses Reset to default.",
    ],
  },
  {
    version: "1.18.1",
    date: "2026-09-15",
    title: "Teacher changes show up right away",
    announce: true,
    fixes: [
      { text: "On the Teachers page, a changed role, grade and section, deactivation or removal now shows the moment you save. You no longer wait minutes or hard-refresh the page.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
      "School Heads' changes on the Teachers page save faster, because the page no longer loads twice after each save.",
    ],
  },
  {
    version: "1.18.0",
    date: "2026-09-15",
    title: "Shorter IP lists, a searchable tutor picker, and a new sidebar picture",
    announce: true,
    fixes: [
      { text: "The dashboard now lists only the top 5 schools with IP learners. Click View all to see every school.", roles: ["SUPER_ADMIN"] },
      { text: "The IP learners by group chart shows the 5 largest groups. Smaller groups are combined into Others, and View all lists every group.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
      { text: "When you pick an ARAL tutor, you can search by name, and the list shows a scroll bar.", roles: ["TEACHER", "SCHOOL_HEAD", "SUPER_ADMIN"] },
      "The side menu now shows an \"Every Learner, Brighter Tomorrows\" picture below the last menu button.",
    ],
  },
  {
    version: "1.17.0",
    date: "2026-09-15",
    title: "Default term subjects, IP learner dashboards, and faster teacher updates",
    announce: true,
    fixes: [
      { text: "Super Admins can set the default End of Terms subjects for each grade. New schools and resets use these subjects.", roles: ["SUPER_ADMIN"] },
      { text: "School Heads have a new Reset to default button on the Term Subjects page. It resets every grade at once. Grades already entered are kept.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
      { text: "The dashboard shows the average number of learners per active teacher: for every school on the Super Admin dashboard, and for your own school on the School Head dashboard.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
      { text: "The dashboard now shows Indigenous Peoples (IP) learners: how many there are, the percentage of learners, a list, and a chart of IP groups.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
      { text: "A deactivated or removed teacher now leaves the Teachers list the moment you click.", roles: ["SCHOOL_HEAD", "SUPER_ADMIN"] },
      "Re-importing Grade 1 and Grade 2 learners whose saved reading level uses the old levels no longer fails.",
    ],
  },
  {
    version: "1.16.0",
    date: "2026-09-15",
    title: "Grade 1 and Grade 2 reading levels match Grade 3, and teacher changes stick",
    announce: true,
    fixes: [
      "Grade 1 and Grade 2 reading levels now use the same levels as Grade 3. They still record Filipino only.",
      "Kinder reading levels are unchanged.",
      "On the Teachers page, a teacher's advisory no longer snaps back to the old value after you change it.",
      "A teacher you deactivate or remove no longer reappears in the list a moment later.",
      "A declined teacher you allow to register again now leaves the Declined list right away.",
      "The Teachers page has a new Refresh button that loads the latest teacher details without reloading the page.",
    ],
  },
  {
    version: "1.15.0",
    date: "2026-09-15",
    title: "School Heads can now set the subjects on End of Terms Reports",
    announce: true,
    fixes: [
      "School Heads have a new Term Subjects page where they can add, rename, reorder and remove the subjects on each grade's End of Terms sheet.",
      "Each grade can have its own list of subjects. Every grade starts with the same eight subjects as before.",
      "Removing a subject hides it from the sheet, the export, the reports and the general average. Grades already entered are kept and come back if the subject is restored.",
      "Renaming a subject keeps every grade already entered under it.",
      "End of Terms sheets and exports now show the subjects your School Head has set for your grade.",
    ],
  },
  {
    version: "1.14.0",
    date: "2026-09-14",
    title: "New reading levels for Kinder to Grade 2 and Senior High",
    announce: true,
    fixes: [
      "Kinder, Grade 1 and Grade 2 now record reading as Level 0 to Level 3: cannot name and sound letters, letter level, CV blending, and CVC blending.",
      "Grade 1 and Grade 2 are assessed in Filipino only, and their monthly reading is no longer marked incomplete for a missing English level.",
      "Grade 11 and Grade 12 choose from Independent Level, Instructional Level and Frustration Level.",
      "Writing is no longer asked for in monthly reading or on the learner form. Writing already saved is kept.",
      "Adding a learner now starts by choosing which of your advisory sections they join, with grade and section shown together.",
      "Learners can be enrolled up to age 70.",
      "Overweight is now a nutritional status option.",
      "Your dashboard shows the Pending Profiles count again.",
      "Learners with a reading level from before these changes can still be edited without re-assessing them.",
    ],
  },
  {
    version: "1.13.0",
    date: "2026-09-14",
    title: "Advising more than one section works properly",
    announce: true,
    fixes: [
      "If you advise sections in more than one grade, End of Terms Reports now asks which class you mean instead of always opening the first one. Every section you advise is listed, and you can switch between them from the sheet itself.",
      "If you advise two sections in the same grade, the sheet now names which one you are encoding, so grades can no longer land on the wrong class.",
      "The advisory setting is now called \"Multi-advisory\" everywhere, instead of \"Multi-grade\". Your sections do not have to be in the same grade level, and the old wording suggested they did.",
      "When you set up multi-advisory during profiling, each section now has its own grade picker, so you can pick a Grade 3 section and a Grade 4 section together.",
      "Learner Profiling has been taken out of the side menu, and the Complete Profiling and Update Profiling buttons, the profile status columns and the Pending Profiles card have gone with it. Nothing you have already saved was deleted.",
      "Weekly attendance, monthly reading level, ARAL enrolment and End of Terms Reports all work without an ARAL profile, and no longer ask you to fill one in first.",
      "Floating teachers keep their ARAL work. Only the class roster and the end-of-term sheet are closed to them, and both now say so in place.",
      "The suggestion list that appears when you mention someone in a message is now a proper button, so it reads correctly to a screen reader and matches the rest of the app.",
    ],
  },
  {
    version: "1.12.3",
    date: "2026-09-14",
    title: "Nightly backups fit the new hosting",
    announce: false,
    fixes: [
      "Automatic backups no longer include the activity log, which had grown large enough to stop a backup from being made at all.",
      "Restoring a backup no longer erases the activity log, so the record of who restored what survives the restore.",
    ],
  },
  {
    version: "1.12.2",
    date: "2026-09-14",
    title: "Error-record cleanup no longer waits on the backup",
    // Infrastructure only — see 1.12.1.
    announce: false,
    fixes: [
      "The daily cleanup of old error records now runs even when the nightly database backup cannot finish.",
    ],
  },
  {
    version: "1.12.1",
    date: "2026-09-13",
    title: "Scheduled backups and database routing restored",
    // Infrastructure only — nothing a teacher or School Head does changes, so
    // this must not interrupt anyone with an update modal.
    announce: false,
    fixes: [
      "Automatic nightly and weekly database backups run again. They stopped when the app moved to its new hosting and had not been running since.",
      "The app reaches the database over its fast pooled connection again, which had quietly fallen back to a slower route on the new hosting.",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-09-13",
    title: "Recoverable learner archives and profiling",
    announce: true,
    fixes: [
      "Teachers now archive learners instead of deleting them, and can restore archived learners from the Learners page.",
      "Learners removed with the previous Delete control are visible in Archived learners and can be restored.",
      "Learner Profiling now has a dedicated Learners-page button and sidebar entry, with clearer Complete Profiling and Update Profiling actions.",
      "The former ARAL Dashboard is now named Learner Profiling throughout the teacher workspace.",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-09-13",
    title: "Email support and faster conversations",
    announce: true,
    fixes: [
      {
        text: "Super Admins can send one email or separate private copies to multiple teachers, School Heads, or manually entered addresses from the Support workspace.",
        roles: ["SUPER_ADMIN"],
      },
      "Password-recovery messages now come from LITRACK Support and outgoing email includes the LITRACK logo and a clearer branded layout.",
      {
        text: "Existing support conversations open with their messages immediately instead of waiting on an extra opening step.",
        roles: ["SUPER_ADMIN"],
      },
      "The sign-in screen no longer fails to load under the local Turbopack development server.",
    ],
  },
  {
    version: "1.10.1",
    date: "2026-09-13",
    title: "Cloudflare can reach school data again",
    announce: true,
    fixes: [
      "LITRACK can connect to Supabase again after the move from Vercel to Cloudflare.",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-09-12",
    title: "Support conversations now show real availability",
    announce: true,
    fixes: [
      {
        text: "Super Admins can work through school conversations and support tickets in a clearer two-pane support workspace.",
        roles: ["SUPER_ADMIN"],
      },
      "Teacher activity now appears as Online or Last online in private support conversations, without counting administrator impersonation as teacher activity.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-09-12",
    title: "A clearer account management workspace",
    announce: true,
    fixes: [
      {
        text: "Super Admins can see account totals, filter the directory, and work through account details in a clearer, more compact Accounts Management page.",
        roles: ["SUPER_ADMIN"],
      },
      "The account directory has a clearer responsive layout while keeping its existing password and troubleshooting actions.",
    ],
  },
  {
    version: "1.8.2",
    date: "2026-09-12",
    title: "Teacher roster filters and reliable term reports",
    announce: true,
    fixes: [
      "School Heads can filter the Teachers page by Non-DepEd ARAL Volunteer, Teacher, Floating, Multi advisory, or With advisory.",
      "Teachers with more than one advisory section can open End of Terms Reports from any of their advised grades without a Page not found error.",
    ],
  },
  {
    version: "1.8.1",
    date: "2026-09-12",
    title: "The account support update now appears after sign-in",
    announce: true,
    fixes: [
      "The account support update now appears in the one-time update notice after sign-in and stays available in release history after it is acknowledged.",
      {
        text: "Super Admins can find any teacher or School Head in the new Accounts console, inspect account status, reset credentials, and securely sign in as that account while troubleshooting.",
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-09-12",
    title: "Account support is now in one place",
    announce: false,
    fixes: [
      "School account support is now organized in one console, making it faster for administrators to find an account and resolve sign-in problems.",
      {
        text: "Super Admins can inspect account details, issue temporary passwords, and securely sign in as a teacher or School Head while troubleshooting.",
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
  {
    version: "1.7.1",
    date: "2026-09-12",
    title: "Removing a teacher from a school now works",
    announce: true,
    fixes: [
      // Not restricted. These describe a screen only a Super Admin can open,
      // which is explicitly NOT a reason to restrict — see `ReleaseNote` above.
      // Neither note discloses a capability over anyone's own data: that an
      // administrator can remove an account is how the school already works,
      // and saying the button was broken tells a teacher nothing about
      // themselves they did not already know.
      "Removing a teacher or a learner from a school page works. The buttons have been there since the page was built, but every one of them failed with a reference code instead of removing anything — the page could not load the code behind its own forms.",
      "The Danger zone on a school page, and the database console, are fixed by the same change.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-09-12",
    title: "Removed teachers and learners now have a home, and a way out",
    announce: true,
    fixes: [
      {
        text: "Removed teachers and learners from every school now collect in one place, under Archive. You can put a row back, or delete it for good.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "Restoring a teacher brings the record back but not the sign-in. The account cannot log in until a School Head sends a new invite, or the teacher registers again with their email. The screen says so before you restore, and again after.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "Deleting for good says exactly what goes first — the attendance, assessments, grades and enrolments, counted. It is one row at a time, and it cannot be undone.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "Permanently deleting a teacher leaves every attendance mark, assessment and grade they recorded in place, but the name of who recorded it is blanked and cannot be recovered. The confirmation says this before you agree to it.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "A removed teacher whose school was deleted can still be cleaned up from the Archive, rather than sitting there refusing to go.",
        roles: ["SUPER_ADMIN"],
      },
      "Restoring a learner now puts them back in the grade and section they hold today, instead of the ones they held when they were removed.",
    ],
  },
  // 1.2.0–1.6.0 were written on 2026-09-12, after the fact: these changes had
  // already shipped with no entry. One version per group, in the order each
  // group reached main.
  {
    version: "1.6.0",
    date: "2026-09-12",
    title: "ARAL grids: clear a row, save part of a month, reopen a window",
    announce: true,
    fixes: [
      "You can clear a row in the weekly attendance and monthly reading level grids. The row stays cleared when you press Save.",
      "The monthly reading level sheet now saves rows you have only partly filled, instead of refusing the whole page.",
      "Monthly reading levels can now have a deadline, 7 days after the month ends. It is not enforced for now.",
      "A closed week, month, or term can be reopened for entry. Your division admin arranges it, and you are told when your own entry window reopens.",
      {
        text: "The submissions console reopens a week, month, or term for one teacher or a whole school, for 1 to 90 days, and lists and revokes the unlocks in force.",
        roles: ["SUPER_ADMIN"],
      },
      "Teachers who advise more than one section now pick the grade and section when they add a learner.",
      "The search results, the report date range and the school year suggestion are keyboard- and touch-friendly buttons like the rest of the app.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-11",
    title: "Clearer errors, and a reference code when something breaks",
    announce: true,
    fixes: [
      "When sign-in fails, LITRACK now says what went wrong. When your session ends, it says why.",
      "Error pages show a reference code you can give to support. A missing page offers a way back, and pages you cannot open say so.",
      {
        text: "The error log is searchable by that reference code, on the admin console.",
        roles: ["SUPER_ADMIN"],
      },
      "Visitors no longer see server configuration details on the sign-in page.",
      "The link from the login page to the admin sign-in works reliably.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-11",
    title: "Floating teachers and teachers who advise several sections",
    announce: true,
    fixes: [
      "Profiling asks once whether a teacher floats, advises one section, or advises several. The number of sections they may hold follows that answer.",
      "An ARAL Volunteer cannot hold an advisory section.",
      "School Heads can set a teacher's designation and advisory load, and see which sections a change unassigns before confirming.",
      "School Heads are told which sections have learners but no adviser.",
      "Removing a teacher frees their sections. The Teachers page lists the teachers who were removed.",
      "A floating teacher's class menus are closed, and say why.",
      "A teacher with no section can save their profile. A School Head can release sections a teacher holds past their limit.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-11",
    title: "A one-voice assistant, and School Head password recovery",
    announce: true,
    fixes: [
      "The assistant now gives one answer, instead of replacing an answer while you read it. If it cannot answer, it says so and points you to your division admin.",
      {
        // Restricted: telling every School Head that their chosen password can
        // be read back is a privacy disclosure, and a changelog is the wrong
        // place for a person to learn it. The capability itself is audited, and
        // the runbook is where a head is told how their credential is handled.
        text: "A School Head's own password can be recovered from the school accounts console when they are locked out, rather than only reset. Restricted to Super Admins, rate limited, and every reveal writes an audit row naming who viewed it.",
        roles: ["SUPER_ADMIN"],
      },
      "The sidebar shows “LITRACK by Apache Spark” with the version, above your profile. The account menu no longer has a second Sign out.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-09-11",
    title: "Learner form fixes",
    announce: true,
    fixes: [
      "The ethnicity you pick on the learner form no longer snaps back to “Not specified”.",
      "The profile completion bar keeps up while you type.",
      "The ethnicity add and remove links are proper buttons, and dropdown options read correctly with a screen reader.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-11",
    title: "Term windows each school can set",
    announce: true,
    fixes: [
      "A term can stay open for entry after its months end. School Heads set this for their own school.",
      "The grade sheet uses your school's own term deadline.",
    ],
  },
  {
    // The ten concerns raised alongside 1.0.0 — the spec calls them "the first
    // release notes", and this is the entry that announces itself. Minor, not
    // patch: several are features. Announced because they change what teachers
    // see on their ARAL pages and on the School Head's Teachers page.
    version: "1.1.0",
    date: "2026-09-11",
    title: "Up to three advisory sections, and clearer ARAL pages",
    announce: true,
    fixes: [
      "ARAL pages now list only the learners you are the designated ARAL tutor for. Learners in your class who have a different tutor stay on your Learners page.",
      "A teacher can now advise up to three sections. School Heads add and remove them on the Teachers page.",
      "A teacher without an advisory section can finish their profile by answering No to “Do you advise a classroom section?” They show as Floating on the Teachers page until one is assigned.",
      "School Heads can deactivate a grade level that was added by mistake, and restore it later. A grade that still has learners cannot be deactivated.",
      "An archived section no longer shows as a teacher's assignment.",
      "Weekly attendance and term grades have no editing deadline for now. Your division admin can switch deadlines back on.",
      "LITRACK now tells you what changed after an update. The version number at the bottom of the sidebar opens every release's notes.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-10",
    title: "LITRACK 1.0",
    announce: false,
    fixes: [
      "First numbered release. Everything the app does today, gathered under one version number.",
    ],
  },
];

/** The version the running app reports. Mirrored in `package.json`. */
export const APP_VERSION = RELEASES[0].version;

/**
 * Compare two semver strings numerically.
 *
 * Written out rather than pulled from a library because string comparison gets
 * this wrong in a way that looks right: `"1.0.10" < "1.0.9"` as strings, so a
 * tenth patch would sort behind the ninth and the modal would stop firing.
 *
 * Returns negative when `a` is older, positive when `a` is newer, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The notes in a release this reader may see, in order.
 *
 * The single door to `release.fixes`. A bare-string note is for everybody; an
 * object note reaches only the roles it names. A reader whose role is unknown
 * (`null` — nothing signed in, or a role this list does not name) sees only the
 * unrestricted notes, which is the safe direction: a restricted note is
 * restricted because reading it discloses something.
 */
export function visibleFixes(
  release: Release,
  role: ReleaseAudience | null
): string[] {
  return release.fixes
    .filter((fix) => typeof fix === "string" || (role !== null && fix.roles.includes(role)))
    .map((fix) => (typeof fix === "string" ? fix : fix.text));
}

/** The release the app is currently running. */
export function latestRelease(): Release {
  return RELEASES[0];
}

/**
 * The releases to show a user whose last acknowledged version is `lastSeen`,
 * newest first. Several versions can ship between two sign-ins, and the modal
 * lists every one of them once rather than only the newest.
 *
 * - Already on the current version: nothing.
 * - Never acknowledged one (`null`), a version this list does not know, or a
 *   version newer than the head (a rollback): the current release only. A new
 *   account does not need the whole history; that lives at /releases.
 * - Otherwise: every announcing release newer than `lastSeen`.
 *
 * Takes the list as a parameter so tests can pin the rules without depending on
 * the committed history.
 */
export function unseenReleases(
  lastSeen: string | null,
  releases: readonly Release[] = RELEASES
): Release[] {
  const head = releases[0];
  if (lastSeen === head.version) return [];
  const seen = lastSeen ?? "";
  const known = releases.some((r) => r.version === seen);
  if (!known || compareVersions(seen, head.version) > 0) {
    return head.announce ? [head] : [];
  }
  return releases.filter(
    (r) => r.announce && compareVersions(r.version, seen) > 0
  );
}

/**
 * The landmark release to welcome this user to, or null.
 *
 * Unlike `unseenReleases`, a brand-new account (`null`) is welcomed even after
 * later patches ship: the welcome is once per account, not once per head. Only
 * an acknowledgement of this version or a later one retires it.
 */
export function welcomeRelease(
  lastSeen: string | null,
  releases: readonly Release[] = RELEASES
): Release | null {
  const landmark = releases.find((r) => r.welcome);
  if (!landmark) return null;
  if (lastSeen !== null && compareVersions(lastSeen, landmark.version) >= 0) {
    return null;
  }
  return landmark;
}

/** The welcome cards this reader may see, in order. */
export function visibleHighlights(
  welcome: ReleaseWelcome,
  role: ReleaseAudience | null
): ReleaseHighlight[] {
  return welcome.highlights.filter((h) => forReader(h.roles, role));
}

/** The tour steps this reader may see, in order. */
export function visibleGuide(
  welcome: ReleaseWelcome,
  role: ReleaseAudience | null
): ReleaseGuideStep[] {
  return welcome.guide.filter((step) => forReader(step.roles, role));
}

function forReader(
  roles: readonly ReleaseAudience[] | undefined,
  role: ReleaseAudience | null
): boolean {
  return !roles || (role !== null && roles.includes(role));
}
