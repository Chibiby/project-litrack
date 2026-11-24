# Sidebar Badges Implementation Plan

> Executed inline (Native), owner-approved spec:
> `docs/superpowers/specs/2026-11-24-sidebar-badges-design.md`.

**Goal:** count badges on side-menu rows, team-wide Super Admin chat read state.

## Rulings against the spec (found during recon)

- Section-move requests are decided on the School Head **Learners** page
  (`transfer-requests-panel`), not Transfer — their count badges `school-head-learners`.
  Transfer counts incoming cross-school transfers only.
- A Super Admin viewing a school sees no School Head badges: the layout cannot
  know which `?schoolId=` is in view (existing rule for the Teachers badge).
- The Super Admin Support count is uncached (accuracy for the 30 s poll; cheap,
  few admins). District uses the existing cached open-ticket count.

## Tasks

1. `applyNavBadges(groups, badges)` + `formatNavBadge(n)` ("99+") in
   `src/lib/nav/nav-config.ts`; `NavOptions.badges`. Tests: `tests/unit/nav-badges.test.ts`.
2. Team-wide read: `listAdminChatSchools` reads any Super Admin's latest read;
   `markChatNotificationsReadForAdmins(channelId)` called by `markChannelRead`
   and `sendMessage` when the actor is a Super Admin. Tests extend existing chat tests.
3. Counts in `src/lib/nav/badges.ts` (server-only): admin, district, School Head,
   teacher. Tests with mocked Prisma.
4. GET `/api/nav/badges` (Super Admin + district admin only) and a client
   `NavBadgesProvider` in `RoleShell` that resolves the layout's promise and
   polls every 30 s while visible for those two roles. Sidebar renders the
   badge with screen-reader text.
5. Wire layouts; gates; browser check; release entry on push.
