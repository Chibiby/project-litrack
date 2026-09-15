# LitRack v2 — End of Terms Reports

Owner mockups: desktop, mobile, and `public/brand/banner-learner.png` (same art as the Learners page).

## Decisions (owner, 2026-09-15)

- **All Advisories is the default** on this page and on Learners (Learners already defaults to it). A teacher can narrow to one advisory; the filters follow the choice.
- **Subject filter** shows only that subject's column. View only; nothing is saved by it.
- **Phones:** 5 subjects per row. Both the header chevron and each row's chevron step to the next 5 subjects.
- **Header buttons dropped:** Weekly attendance, Monthly reading level and Enroll as ARAL leave this page. The sidebar has the first two; enrolling happens on the ARAL roster.
- **App header:** no page title beside the menu toggle, on any page. Every page names itself in its own banner.
- **Advisory control (this page and Learners):** one highlighted dropdown (All advisories, then each section). No "Advisory" label, no ‹ › arrows, no separate Advisory filter.
- **Phones follow the mockup's density:** a smaller title, all three term tabs in one row, compact stat cards with one-line titles.
- **Merge:** main is not merged yet. Only the ARAL Profiling change (1.19.0, `8757cf4`) is copied in, without its version bump.

## Route

`/teacher/terms-reports` becomes the teacher's sheet.

- `?advisory=<sectionId>` narrows to one advisory; absent means All Advisories.
- `?section=`, `?term=`, `?q=`, `?page=`, `?perPage=` as before.
- `/teacher/aral/[gradeId]/terms-reports` redirects a teacher to the new route, carrying `?section=` over as `?advisory=` (or the grade's only advisory), plus `term`, `q`, `page`, `perPage`. Bookmarks keep working.
- A Super Admin still opens the grade page; it renders the same v2 view with one group (the whole grade, with its section facet).
- The sidebar's End of Terms Reports row always points at `/teacher/terms-reports`.
- Gates (volunteer, floating, no advisory, no school year) are unchanged and read the same.

## Layout (top to bottom)

1. `PageHero` with the learner banner: "End of Terms Reports — Grade 3" (or "— All Advisories" when the scope spans grades), then "First Term (August – October) · SY 2026–2027". Term tabs (First, Second, Third with ranges, lock icon when locked) sit inside the hero, under the subtitle.
2. Four stat cards (the shared `StatCard`, `inlineOnPhone`): **Total Learners**, **Grades Saved** "6 / 30" with a progress bar, **Completion Rate** "20%", **Class Average** "86.63".
3. The Auto-Lock card, unchanged copy.
4. Table panel. Toolbar: name search, Section and Subject dropdowns, the highlighted advisory dropdown, Export, Save Grades. Phones: search + export icon + Save on one row, the advisory dropdown on its own row.
5. Grid. Heading "Subjects and Grades" over "First Term – 20%" (the completion rate). General Average column in violet.

## Scope and the combined grid

- Scope = the teacher's advisory placements, narrowed by `advisory`, then by `section`. The Section dropdown lists the sections in the current advisory scope; picking an advisory clears Section.
- Phones show five subjects per row; both chevrons step to the next five, wrapping to the first.
- Learners are grouped by advisory in placement order, then by name. A group heading row names it ("Grade 3 – Atis"). A new subject header row appears at each group, because each grade has its own subjects.
- Paging runs across the combined list: per-section counts decide which sections and slices land on the current page.
- The Subject dropdown lists the subjects in scope by name. Picking one hides the other columns without remounting the grid, so unsaved edits survive.

## Figures

Counted over the whole scope for the active term, ignoring the name search:

- **Total Learners:** learners in scope.
- **Grades Saved:** learners with a score in every active subject of their grade. Shown as `complete / total` with a bar.
- **Completion Rate:** `round(complete / total × 100)%`, "N of M learners". 0% when there are no learners.
- **Class Average:** mean of the general averages of complete learners, two decimals; "—" when none are complete.

## Save and export

- `termGradesSaveSchema` gains optional `sectionId`. The grid sends one save per group that has changes, each naming its section, so the existing advisory gate resolves exactly one placement. This also fixes multi-advisory saves, which today fail with "Choose which one this belongs to".
- `termGradesExportSchema` gains optional `sectionIds` (max 3). A teacher export builds one workbook with a worksheet per section; each section passes the same gate. A Super Admin export is unchanged.
- Save revalidates `/teacher/terms-reports` as well as the grade page.

## Tests

Stat math (pure helper), combined paging slices (pure helper), subject paging for phones, the redirect target, save and export with `sectionId(s)`, the header carrying no title, nav href.

## Not changed

Term windows, locking and unlock grants, the 60–100 score rule, audit rows, tenancy clauses. No schema change.
