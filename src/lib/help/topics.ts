import type { UserRole } from "@prisma/client";

/**
 * The assistant's entire knowledge base.
 *
 * Deliberately hand-written data, not a model call. Three reasons, in order of
 * weight:
 *
 * 1. Every answer is about learner records, so a model backend would mean
 *    school data leaving the country's borders for a third-party API — a
 *    Data Privacy Act problem this file does not have.
 * 2. Answers are deterministic, so a wrong answer is a bug someone can fix here
 *    rather than a prompt someone has to re-tune.
 * 3. It costs nothing per message and works with the network down.
 *
 * `answerQuery` in `./search` is the only consumer, which is the seam a model
 * backend would slot into later without the UI or the ticket flow noticing.
 *
 * Plain data with no imports beyond the role type, so this is safe in a client
 * component — the whole index ships to the browser and answers land instantly.
 */

export type HelpTopic = {
  id: string;
  /** The question as a person would ask it. Rendered as the answer's heading. */
  title: string;
  /**
   * Extra words that should match this topic but do not appear in the title or
   * body — synonyms, DepEd vocabulary, and the words people actually type.
   */
  keywords: string[];
  /**
   * The answer, one short paragraph per array entry. Plain text: it is rendered
   * escaped, never as HTML or Markdown, because this is chat output.
   */
  body: string[];
  /** Roles that should ever see this topic. Empty means all roles. */
  roles?: UserRole[];
  /**
   * Route prefixes this topic is about. Used for the "On this page" suggestions
   * and as a ranking boost — never as a filter, so a topic stays findable by
   * search from anywhere.
   */
  routes?: string[];
  /** Where to go to actually do the thing. Shown as a link under the answer. */
  action?: { label: string; href: string };
};

export const HELP_TOPICS: HelpTopic[] = [
  // ── Deadlines and locks ───────────────────────────────────────────────────
  {
    id: "attendance-week-locked",
    title: "Why can't I edit last week's attendance?",
    keywords: [
      "locked",
      "lock",
      "closed",
      "deadline",
      "past due",
      "expired",
      "read only",
      "cannot save",
      "greyed out",
      "grayed out",
      "disabled",
    ],
    body: [
      "A week of ARAL attendance stays editable for 7 days after it ends. Once that grace period passes the grid becomes read-only and saves are refused, so the record matches what was true at the time.",
      "If you genuinely need to correct a closed week, use Request Access in this assistant. Your request goes to the division admin, and if they approve it you get temporary write access to that one week — it closes again on its own when the access expires.",
    ],
    roles: ["TEACHER"],
    routes: ["/teacher/aral"],
  },
  {
    id: "term-closed",
    title: "The term is closed and I still need to encode grades",
    keywords: [
      "term",
      "closed",
      "locked",
      "grades",
      "end of term",
      "encode",
      "quarter",
      "grading period",
      "too late",
    ],
    body: [
      "Each term covers three months of the school year and closes at the end of its last month. After that the grade sheet is read-only for everyone, including the school head.",
      "Submit a Request Access ticket from this assistant naming the term you need. An approved request reopens that term for you alone, and only until the access expires.",
    ],
    routes: ["/teacher/aral", "/teacher/reports"],
  },
  {
    id: "request-unlock-how",
    title: "How do I ask the division admin to unlock something?",
    keywords: [
      "unlock",
      "request access",
      "permission",
      "admin",
      "division",
      "ticket",
      "escalate",
      "help from admin",
      "open again",
      "reopen",
    ],
    body: [
      "Tap Request Access in this assistant. Pick what you need reopened — a week of attendance or a term's grade sheet — say which one and why, then send.",
      "The division admin sees it in their support inbox. You get a notification when they respond, and you can check the request's status any time under Recent in this panel.",
      "Approved access is always temporary and only ever applies to you and the one period you asked about.",
    ],
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  {
    id: "attendance-mark-week",
    title: "How do I record weekly ARAL attendance?",
    keywords: [
      "attendance",
      "weekly",
      "mark",
      "present",
      "absent",
      "late",
      "excused",
      "grid",
      "check",
    ],
    body: [
      "Open Weekly Attendance, pick the week with the arrows at the top, then set each learner's mark for each day. Only the cells you change are saved, so an untouched day keeps whatever it already had.",
      "Days flagged as holidays are skipped automatically and do not count against a learner's rate.",
    ],
    roles: ["TEACHER"],
    routes: ["/teacher/aral"],
    action: { label: "Go to Weekly Attendance", href: "/teacher" },
  },
  {
    id: "attendance-summary",
    title: "Where do I see my class's attendance rate?",
    keywords: [
      "summary",
      "rate",
      "percentage",
      "overview",
      "statistics",
      "how many present",
      "unmarked",
    ],
    body: [
      "The Attendance Overview card on your dashboard shows this week's totals and present rate, broken down by Present, Late, Absent, Excused and Unmarked.",
      "For a longer range, generate an Attendance report from Reports — you can set the date range there and export it as Excel or PDF.",
    ],
    routes: ["/teacher", "/school-head"],
    action: { label: "Open Reports", href: "/teacher/reports" },
  },

  // ── Reading level ─────────────────────────────────────────────────────────
  {
    id: "reading-level-monthly",
    title: "How do I submit the monthly reading level?",
    keywords: [
      "reading",
      "level",
      "monthly",
      "phil iri",
      "assessment",
      "pending",
      "completion",
      "frustration",
      "instructional",
      "independent",
    ],
    body: [
      "Open Monthly Reading Level, choose the month, and record a level for each learner. The dashboard's Reading Level Overview counts a learner as Completed once they have a record for the current month.",
      "A learner showing as Pending simply has no record yet for that month — it is not an error.",
    ],
    roles: ["TEACHER"],
    routes: ["/teacher/aral"],
  },

  // ── Learners ──────────────────────────────────────────────────────────────
  {
    id: "learner-find",
    title: "How do I find or update a learner?",
    keywords: [
      "learner",
      "student",
      "pupil",
      "search",
      "profile",
      "edit",
      "info",
      "record",
      "lrn",
    ],
    body: [
      "Use the search box in the header, or open Learners for the full roster with filters. Selecting a learner opens their profile, where their details, ARAL profile and history all live.",
      "You only ever see learners in your own school, and teachers only see the ones in their care.",
    ],
    routes: ["/teacher/learners", "/school-head"],
    action: { label: "Open Learners", href: "/teacher/learners" },
  },
  {
    id: "learner-pending-profile",
    title: "What does \"Pending Profiles\" mean?",
    keywords: [
      "pending",
      "profile",
      "incomplete",
      "aral profile",
      "missing",
      "without",
    ],
    body: [
      "It counts learners in the ARAL program who have no ARAL profile filled in yet. The profile is the intake survey — reading background, home environment, and the rest.",
      "Open Manage profiles from the dashboard card to work through them.",
    ],
    roles: ["TEACHER"],
    routes: ["/teacher"],
  },
  {
    id: "learner-archive",
    title: "A learner left. Do I delete them?",
    keywords: [
      "delete",
      "remove",
      "archive",
      "transfer",
      "dropped",
      "moved out",
      "left school",
    ],
    body: [
      "Archive them rather than deleting. Archiving keeps their attendance and reading history intact for reporting while taking them out of your active roster.",
      "If they moved to another school in the division, ask your school head to record a transfer instead — that carries the record across properly.",
    ],
    routes: ["/teacher/learners"],
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  {
    id: "reports-generate",
    title: "How do I generate a report?",
    keywords: [
      "report",
      "export",
      "excel",
      "pdf",
      "download",
      "print",
      "generate",
      "hub",
    ],
    body: [
      "Open Reports, pick the report you want, set the date range and any grade or section filter, then choose Excel or PDF.",
      "Recent Reports keeps a history so you can re-generate the same report later. The file itself is not stored — it is rebuilt from the filters each time, so it always reflects current data.",
    ],
    routes: ["/teacher/reports", "/school-head/reports"],
    action: { label: "Open Reports", href: "/teacher/reports" },
  },
  {
    id: "reports-empty",
    title: "My report came out empty",
    keywords: ["empty", "blank", "no data", "no rows", "nothing", "zero"],
    body: [
      "Almost always the date range. A report only covers records that exist inside it, so a range before the school year started, or a month with no encoding yet, produces no rows.",
      "Widen the range, or clear the grade and section filters, and generate again.",
    ],
    routes: ["/teacher/reports", "/school-head/reports"],
  },

  // ── Account ───────────────────────────────────────────────────────────────
  {
    id: "account-password",
    title: "How do I change my password?",
    keywords: [
      "password",
      "change password",
      "reset",
      "forgot",
      "credentials",
      "sign in",
      "login",
      "locked out",
    ],
    body: [
      "Open your account menu at the bottom of the sidebar and choose the password option.",
      "If you cannot sign in at all, contact your school head — school head and teacher accounts created without a personal email address cannot use email password recovery, so their credentials are regenerated for them instead.",
    ],
  },
  {
    id: "account-pending-approval",
    title: "My account says it is waiting for approval",
    keywords: [
      "pending",
      "approval",
      "waiting",
      "not approved",
      "registered",
      "activate",
      "access",
    ],
    body: [
      "A teacher who self-registers stays pending until their school head approves the account. Until then the dashboard is not available.",
      "If it has been longer than you expect, ask your school head to check the Pending tab on their Teachers page.",
    ],
    roles: ["TEACHER"],
  },
  {
    id: "theme-dark-mode",
    title: "Can I use dark mode?",
    keywords: ["dark", "light", "theme", "night", "appearance", "colors"],
    body: [
      "Yes — the sun and moon button in the top-right of the header switches between light and dark. Your choice is remembered on this device.",
    ],
  },

  // ── School head ───────────────────────────────────────────────────────────
  {
    id: "sh-approve-teachers",
    title: "How do I approve a teacher?",
    keywords: [
      "approve",
      "teacher",
      "pending",
      "reject",
      "registration",
      "new teacher",
      "invite",
    ],
    body: [
      "Open Teachers and go to the Pending tab. Each row can be approved or declined; approving activates the account and lets them sign in.",
      "You can also invite a teacher directly, which sends them a registration link instead of waiting for them to find the site.",
    ],
    roles: ["SCHOOL_HEAD"],
    routes: ["/school-head/teachers"],
    action: { label: "Open Teachers", href: "/school-head/teachers" },
  },
  {
    id: "sh-school-year",
    title: "How do I start a new school year?",
    keywords: [
      "school year",
      "sy",
      "new year",
      "active",
      "enrollment",
      "promote",
      "roll over",
    ],
    body: [
      "Open School and use the Years tab to create the new school year, then set it active. Exactly one school year is active at a time.",
      "Learners created while no year is active are not enrolled into one — set the year first, then build the roster.",
    ],
    roles: ["SCHOOL_HEAD"],
    routes: ["/school-head/school"],
  },
  {
    id: "sh-announcements",
    title: "How do I post an announcement to my teachers?",
    keywords: ["announcement", "post", "notice", "message", "broadcast", "memo"],
    body: [
      "Open Announcements and create one. It appears to the teachers in your school; there is no separate send step.",
    ],
    roles: ["SCHOOL_HEAD"],
    routes: ["/school-head/announcements"],
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  {
    id: "admin-support-inbox",
    title: "Where do teacher support requests arrive?",
    keywords: [
      "support",
      "inbox",
      "ticket",
      "request",
      "unlock",
      "queue",
      "division",
    ],
    body: [
      "Open Support. Requests arrive there newest first, with open ones at the top.",
      "An unlock request can be answered by granting temporary access from the ticket itself — pick how long it should last, and it closes again on its own.",
    ],
    roles: ["SUPER_ADMIN"],
    routes: ["/admin"],
    action: { label: "Open Support", href: "/admin/support" },
  },
  {
    id: "admin-school-view",
    title: "How do I look at one school's data?",
    keywords: [
      "school",
      "drill down",
      "view as",
      "impersonate",
      "tenant",
      "switch school",
    ],
    body: [
      "Open Schools and select one. School head pages accept a school in the address, so you see that school's dashboard exactly as its head does.",
      "Every such view is recorded in the audit log.",
    ],
    roles: ["SUPER_ADMIN"],
    routes: ["/admin"],
  },

  // ── Meta ──────────────────────────────────────────────────────────────────
  {
    id: "assistant-what-can-you-do",
    title: "What can this assistant do?",
    keywords: [
      "help",
      "guide",
      "what can you do",
      "how does this work",
      "assistant",
      "bot",
      "support",
    ],
    body: [
      "Ask about anything in LITRACK — attendance, reading levels, learners, reports, deadlines, your account — and I will point you at the answer and the page that does it.",
      "For anything I cannot answer, or when you need something reopened or a permission changed, use Request Access to send it to the division admin.",
    ],
  },
];
