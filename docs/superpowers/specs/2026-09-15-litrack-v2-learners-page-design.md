# LitRack v2 — Teacher Learners page

Owner mockups: desktop, mobile, and `public/brand/banner-learner.png` (2172×579, transparent top rows 0–46, same geometry as the teacher banners).

## Decisions (owner, 2026-09-15)

- LRN is not stored: the table shows **Age** where the mockup shows LRN.
- **Every filter always shows**: Advisory switcher (‹ select ›), Grade, Section, Advisory, Gender, ARAL Status, More Filters (Sort, Rows per page).
- **Learner Profiling** tab links to `/teacher/aral/profiling` (added by a parallel session; 404 until it merges).
- Row actions: eye (profile) + ⋮ menu (View profile, Enroll as ARAL, Archive; Restore in the archived view). Edit stays in the profile dialog, per the earlier brief that removed Edit from rows.

## Design

1. `PageHero` (shared): two-layer banner with head overflow, lg 1.25× zoom — extracted from the dashboard's `GreetingHero`, which becomes a consumer. Learners hero: "Learners", subtitle, random learner quote.
2. Stat cards: same four counts, decor + tint (Total amber/people, ARAL emerald/bars, Male blue/wave, Female pink/wave). Phones: icon left of text.
3. Tabs row + Advisory switcher + Add New Learner.
4. Filter bar inside the table panel; phones get search + a filter sheet.
5. Table (xl+): checkbox, #, name, Age, Grade & Section, Advisory chip, Gender, English, Filipino, ARAL Status, actions.
6. Phone/tablet list (<xl): one row per learner with meta line, one reading pill, ⋮ menu; compact footer.

URL params: `advisory` (a section the teacher advises; also pins grade), `section`, `grade`, `gender`, `aralStatus`, `sort`, `perPage`. Picking an advisory clears `section`. Access scope, empty states, bulk actions and Super Admin view are unchanged. No schema change.
