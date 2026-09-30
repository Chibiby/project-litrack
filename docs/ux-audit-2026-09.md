# UI/UX audit — September 2026 (release 2.22.0)

Scope: sign-in and account pages, teacher pages, School Head pages, admin and
district pages. Audited against `~/.claude/docs/ux-design-rules.md` by reading
the code; nothing here was measured in a browser.

Findings were split into two groups:

- **Applied** — mechanical fixes that don't change what anyone does (labels,
  accessible names, dark-mode colours, touch targets, confirm dialogs that ask
  the same question more clearly). These shipped in 2.22.0.
- **Needs a decision** — changes to a workflow, a default, or data behaviour.
  None of these were built. Each needs the owner's yes/no, and some need a fact
  only the owner knows.

## Applied in 2.22.0

| Area | Change |
|---|---|
| Sign-in | Errors appear under the wrong field (email, password, confirm password); admin login marks both fields with the same generic message. Typed input is never cleared by a failure. |
| Sign-in | The wizard's bare "Continue" is now "Next: enter email and password" / "Next: enter password", with the reason it's disabled shown on screen instead of only in a tooltip. |
| Sign-in | "Change school" and "Back to sign in" links have 44px touch targets. |
| Password reset | The one-time "Continue" on the reset landing page locks after the first click, so a slow response can't burn the link with a double-click. |
| Password reset | The reset page no longer shows text copied from the link's URL. |
| Account | "Current email" and profiling read-only fields have accessible names for screen readers. |
| Teacher | Save buttons name what they save: Save attendance, Save reading levels, Save grades, Save reading level. |
| Teacher | Attendance quick-mark form defaults to today in Philippine time (it used yesterday before 8:00 AM). |
| Teacher | Three older forms no longer lose typed input when a save fails. |
| Teacher | Attendance cells and week navigation keep tablet-size (44px) targets on an iPad in landscape; MOSY level picker too. |
| Teacher | "Clear week" icon has a visible label; disabled "Transfer student" explains why to screen readers. |
| Teacher | Dark-mode colour fixes on the dashboard notice and duplicate-learner warnings; "grade level(s)" pluralised properly. |
| Teacher | Settings pages show a matching loading skeleton. |
| School Head | Removed the "Apply Filters" button, which only showed a "Filters applied" message — the filters already apply as you change them. Report-history delete now says "Removed from history". |
| School Head | Buttons say Rename section, Save role, Save announcement, Rename subject, Apply filters. |
| School Head | "Allow re-register" now confirms in an app dialog that the declined request and sign-in account are deleted permanently. Decline says they can be allowed to register again from the Declined tab. |
| School Head | A disabled "Remove teacher" shows why, on screen. |
| Admin | Restore backup uses the typed-phrase confirmation (was a browser prompt). Delete backup names the backup and date and says it's permanent. |
| Admin | Turning a school off says it blocks sign-in until turned back on and changes no data. Reset School Head password confirms in an app dialog. |
| Admin / district | Empty lists say whether nothing exists yet or filters are hiding everything, with a Clear filters link. |
| Admin / district | Credential cards readable in dark mode; "By school" summary toggle explains why it's disabled. |

## Decided and built in 2.26.0

The owner approved every item below on 2026-09-30. Numbers refer to the list
under "Needs a decision", kept for the record.

| # | Outcome |
|---|---|
| 1 | Unsaved-changes guard on the weekly attendance, monthly reading level and term grades sheets: "Unsaved changes" tag, and Save and continue / Discard changes / Stay before switching. Tab close prompts too. The browser Back button is not guarded (a page cannot cancel it). |
| 2 | Archive from the learner list (single and bulk) and from the profile page confirms with the count, where to restore, and the ARAL effect. |
| 3 | Terms report has a Filters popover on phones. |
| 4 | Closing Add/Edit learner with changes asks first; the form guard uses an app dialog instead of the browser's confirm. |
| 5 | MOSY dialog button follows the choice; it says the recording tutor can undo a move-out by choosing Stay. |
| 6 | Remove from ARAL says records are kept, the learner can be marked again, and the tutor has to be assigned again. |
| 7 | Change email confirms old → new, and says it takes effect immediately with no confirmation email. |
| 8 | Setting the active school year confirms first. |
| 9 | Removing a section is refused while learners are placed in it (`SECTION_HAS_LEARNERS`); the button is disabled with the count shown. |
| 10 | Removed schools have a Removed tab with Restore (Super Admin). A restored school comes back turned off. |
| 11 | `/district/summary` is a facet index page. |
| 12 | Partial bulk failures show a warning with the failed count (school detail, database console). |
| 13 | Remove = recoverable, Delete permanently = not, across the app. |
| 14 | "Clear everything" takes one safety point before both steps, so Undo restores learner records and teachers. The dialog says Undo rolls back the whole database. |
| 15 | The reset dialog states the school count and that it can't be undone. |
| 16 | Unused `PageHeader`, `reading-level-form.tsx`, `attendance-mark-form.tsx` deleted. |

Security (owner-approved): admin sign-in has a per-address limit on failures
(20 per 15 minutes), failures are never answered sooner than 800 ms, and an
unknown username now makes the same Supabase call as a real one, so neither
timing nor a provider error tells them apart. `cf-connecting-ip` is trusted only
on the Cloudflare build. `reportLoginFailure` validates its input.

Also in this release: every client screen calls actions through `callAction`
(the MOSY export panel was the one gap), and
`tests/unit/errors/client-call-sites.test.ts` now fails if a new screen doesn't.

## Needs a decision (resolved 2026-09-30, see above)

Ranked by how much they affect people.

### Teachers

1. **Unsaved attendance marks are discarded silently** when a teacher changes
   week, grade, or section on the weekly attendance grid (same risk on monthly
   reading levels and term grades). *Proposal:* track unsaved changes, show an
   "Unsaved changes" badge next to Save, and ask Save and continue / Discard /
   Stay before switching. `aral-weekly-attendance-panel.tsx`,
   `aral-monthly-reading-level-panel.tsx`, `terms-report-panel.tsx`.
2. **Archiving learners from the list (single or bulk) has no confirmation**,
   while archiving from the learner profile does. *Proposal:* confirm with the
   count, "hidden from active lists, can be restored from Archived", and the
   ARAL effect. `learner-list-client.tsx`, `learner-bulk-actions.tsx`.
3. **Terms report filters are hidden on phones**, so phone users can't filter
   by section or subject. *Proposal:* a Filters popover like the ARAL one.
4. **Closing the Add/Edit learner dialog discards edits without asking**, and
   the unsaved-changes guard on profile forms uses the browser's own confirm box.
   *Proposal:* an app dialog for both.
5. **MOSY decision dialog** always says "Move out from ARAL?" and "Save MOSY
   Decision", even when the teacher chose Stay. *Proposal:* the button follows
   the choice ("Move out learner" / "Keep in ARAL"). **Needs a fact:** can a
   move-out be undone? The dialog should say.
6. **Remove from ARAL** doesn't say whether the learner can be enrolled again or
   what happens to their weekly records. **Needs the facts** to write it.
7. **Change email** only warns in small print and ends with "Email updated".
   **Needs a fact:** is the new address verified, and does the person sign in
   with it next time? Then confirm with old and new address.

### School Heads

8. **Set active school year is one click with no confirmation**, though new
   enrolments go to the active year. *Proposal:* "Make {year} active? {current}
   stops being active; new enrolments go to {year}. You can switch back."
9. **Remove section** says it can be recreated, but not what happens to learners
   placed in it. **Needs a fact:** do they lose their placement?

### Admin and district

10. **Removing a school says "can be restored by support"**, but there is no
    restore in the app. *Proposal:* say "data is kept, but there is no in-app
    restore", or build a restore. **Needs a decision.**
11. **District summary has no index page** — `/district/summary` is a 404.
    *Proposal:* add the facet index there, as on `/admin/summary`.
12. **Bulk removes report partial failures as success** ("3 removed, 1 failed"
    in a green toast) in the admin school detail view. *Proposal:* a warning
    toast naming which failed.
13. **"Remove" vs "Delete" mean different things in different places.**
    *Proposal:* Remove = recoverable, Delete permanently = not, everywhere.
    Needs sign-off on wording.
14. **"Clear everything for school"** is two steps with no undo stated.
    **Needs a fact:** does the database console's safety point cover it?
15. **Reset all schools' term subjects** — confirm the dialog states the school
    count and that it can't be undone (not verified).
16. Four page-header components coexist; one (`PageHeader`) is unused. Clean-up
    only, low priority.

## Security hardening still open (found in the 2.26.0 review, all low)

- The per-username admin limit (10 per 5 minutes) can be tripped by anyone who
  knows a handle, locking the real admin out for a while. One address alone
  can't sustain it any more; many addresses can.
- The per-address admin limit is checked before and charged after the attempt,
  so a burst of simultaneous requests all pass once per window.
- Every refused (rate-limited) sign-in writes an `ErrorEvent` row.
- `reportLoginFailure` is anonymous, so anyone can credit a fake denied sign-in
  to a real School Head (the response never reveals anything).
- IPv6 clients are limited per full address rather than per /64.

## Security follow-ups found during review (2.25.0; the first three fixed in 2.26.0)

| Severity | Finding |
|---|---|
| Medium | Admin login still reveals which usernames exist through response time: an unknown username returns much faster than a real one with a wrong password. The message is identical (as decided), but there's no per-IP limit on admin failures. Proposal: an IP-based limit on admin sign-in failures and a minimum response time. |
| Medium | The per-IP sign-in limits read the first `x-forwarded-for` entry, which a client can set when the app runs behind Cloudflare. Proposal: prefer `cf-connecting-ip` on Cloudflare. |
| Low | `reportLoginFailure` accepts any `role` and `schoolId` from an anonymous caller into audit rows. Proposal: validate with Zod. |
| Info | After a reset, a School Head's password is the School ID (a public DepEd number) until changed. Owner decision. |

## Other follow-ups (not changed)

- On Cloudflare, page-load crashes are written to Workers Logs only, not to
  `/admin/errors`, so a reference shown on an error page can't be looked up there.
- Changing or resetting a password: if the password changes but LITRACK's own
  record fails to save, the person is told it failed although the new password
  works.
- A Supabase outage mid-session reads as "Your session ended" (middleware fails
  closed on purpose; changing it is a security trade-off).
- Opening a backup download link that fails shows raw JSON in the browser tab.
- The school detail "Clear everything" panel has no "proceed without a backup"
  option (the database console has one), so with no backup store connected it
  is refused with the setup message.
