# ChatCut handoff — ARAL LitTrack training videos

## Why this file exists

ChatCut is installed and registered, but it **cannot run from the Claude cloud session**.
The sandbox's egress policy blocks `api.chatcut.io` at the CONNECT stage (HTTP 403), so the
OAuth handshake never completes and no ChatCut tools load. This is a network policy on the
cloud container, not a broken install — reinstalling will not change it.

Run ChatCut from Claude Code on your own machine instead. Everything below is paste-ready.

---

## Part A — Set up ChatCut locally

Open a terminal on your PC and run, in order:

```sh
claude plugin marketplace add https://github.com/ChatCut-Inc/agent-plugin.git#main
claude plugin install chatcut@chatcut-inc
```

The first command clones a large repo and can sit with no visible progress for a few
minutes. Let it finish. Requires Claude Code **2.1.210+** (check with `claude --version`).

Then start Claude Code and authenticate:

```
/mcp
```

Select the ChatCut server, choose **Authenticate**, and complete the browser sign-in.

Verify:

```sh
claude plugin list                       # chatcut@chatcut-inc, enabled
claude mcp get plugin:chatcut:chatcut    # should not say "Needs authentication"
```

The authoritative success signal is the login output reading
`Authenticated with 'plugin:chatcut:chatcut'`.

**Note on the docs:** the setup page names the login helper `login-chatch.sh`. The actual
file shipped in v1.10.12 is `login-chatcut.sh`. If you use the helper rather than `/mcp`,
use the real name.

ChatCut tools only attach at session start, so start a fresh Claude Code session after
authenticating.

---

## Part B — Sequencing (read this before you record)

**Nothing is captured yet, so ChatCut is not the first step.** ChatCut edits, generates
voice, and assembles — it does not record your screen. The order is:

1. Record the screen takes in OBS, following the script.
2. Hand the takes + script to ChatCut.
3. ChatCut generates voiceover, assembles the timeline, burns captions, exports.

**The 19 screenshots are free.** Every screen on the capture checklist is a moment the
video already passes through. Record the walkthrough first, then pull the 19 stills as
frames out of the OBS footage rather than doing a separate screenshot session. The
mapping is in `aral-recording-plan.md`. Two conditions to hold to:

- Keep the browser at 1920×1080 / 100% zoom for the whole recording, exactly as the
  screenshot checklist requires — that way frames pulled from video match the checklist spec.
- The two controls that must be **open** in the stills (#14 tutor dropdown, #16 reading level
  cell) are already held open in the script — #14 in **Module 3 Part 5**, because that is the only
  take where a teacher and a volunteer are both in the list; #16 in Module 2 Part 8. Hold them a
  beat longer than feels natural so there is a clean frame to pull.
- Six takes are one-shot — the first-sign-in password screen and the three profiling wizards
  cannot be replayed on the same account. The list is in `aral-recording-plan.md`; read it before
  you roll.

---

## Part C — The brief to paste into ChatCut

Once ChatCut is authenticated locally, attach `aral-training-video-script-v2.md` and
`screenshot-capture-checklist-v2.md` plus your OBS takes, and paste this:

> I'm building three training videos for ARAL LitTrack, a DepEd school literacy tracking
> system. Audience is Filipino public school teachers, school heads, and non-DepEd
> volunteers, many watching on a phone in a noisy faculty room.
>
> **Module 1 — For School Heads.** 7 parts, 9:58 of narration.
> **Module 2 — For Teachers.** 9 parts, 12:22 of narration.
> **Module 3 — For Non-DepEd ARAL Volunteers.** 7 parts, 6:34 of narration.
>
> The attached script is authoritative. Each `## PART` is a separate OBS take; each `⏸ Cut
> here` is a hard cut between parts. `[SCREEN]` lines are the screen action, bolded quoted
> lines are the narration.
>
> The takes were recorded straight through in one session, in the order the script lists them,
> because the account state builds up across modules. Split them into three projects — one per
> module, one timeline each — at the module headings.
>
> Per part:
>
> - Video track 1: the OBS take for that part, trimmed to the narration.
> - Audio track 1: generated voiceover from that part's narration, **120–130 wpm**. Warm,
>   unhurried, Philippine English. Do not speed up to fit — extend the video with holds instead.
> - Audio track 2: music bed. Full at each module's intro and outro; **10–15%** under all
>   instruction; **fade to silence** during Module 1 Part 3 and Module 2 Part 6 (the two parts
>   people rewatch).
> - Video track 2: callouts. A highlight ring or arrow on every button **before** the click,
>   never after.
> - Video track 3: burned-in captions across the whole runtime.
>
> Zoom in on exactly five things — these are where people get stuck:
> the district and school pickers (M1 P2 and M2 P2), the password field on first sign in
> (M1 P3), the Designation field in the profiling wizard (M2 P4 and M3 P4), the ARAL tutor
> dropdown (M2 P6 and M3 P5), and the week selector on the attendance grid (M2 P7).
>
> Run at 2× with music raised: Module 2 Part 3, the second and third learner in Module 2
> Part 5, and Module 3 Part 3. These are repetition, not new learning.
>
> Add chapter markers at every part boundary, named with the part names from the script.
>
> Export 1920×1080. Tell me the local path for each module when it's rendered.

---

## Part D — Script corrections: done

Both v1 problems are resolved in `aral-training-video-script-v2.md`, along with twelve more found
by checking the script against the app. The full list is in `script-app-audit.md`; the headline is
that fourteen of twenty-one parts named screens, menus, or fields the app does not have, and three
described steps that are impossible in the order given.

**1. The Part 4 stub is gone.** It was a stub because it conflated two screens. The gate is the
School Head profiling wizard — five steps, about the person — and School information is a separate
five-field tab. v2 splits them into two parts with the real field lists.

**2. Part 3 now demonstrates changing the password** and mentions that Skip for now exists, rather
than the reverse.

**3. The old Module 1 is split in two**, at the seam between the School Head's one-time setup and
the teacher's ongoing job. Three modules now. Each stands alone, so Modules 2 and 3 re-teach
opening the site and choosing the district and school, and each carries its own opening and
closing.

---

## Runtime budget

| | Narration @125 wpm | With holds, zooms, form-filling |
|---|---|---|
| Module 1 — School Heads | 9:58 (1,245 words) | ~12–14 min |
| Module 2 — Teachers | 12:22 (1,546 words) | ~15–17 min |
| Module 3 — Volunteers | 6:34 (820 words) | ~8–9 min |
| **All three** | **28:53 (3,611 words)** | **~35–40 min** |

The v1 estimate of 11:52 for one combined teachers-and-school-heads module was low because v1 did
not describe the work: the two profiling wizards and the learner form are 755 words between them,
and none of it was in the old count. Splitting added about six more minutes — each module's own
opening, closing, and repeat of the district-and-school step.

Nobody watches all three. A school head watches Module 1 once. A teacher watches Module 2. A
volunteer watches Module 3, and the teacher who assigns to them may want Part 5 of it.
