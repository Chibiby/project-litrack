---
name: LITRACK Sign-in
description: The sign-in surface (/login, /admin/login) printed as a DepEd Self-Learning Module cover in ARAL ink.
colors:
  aral-blue: "#013E88"
  aral-navy: "#12294D"
  aral-gold: "#FED110"
  aral-sun: "#FFBA04"
  aral-red: "#E90423"
  aral-slate: "#4C6971"
  aral-edge: "#7B8CA6"
  aral-line: "#B8C6DA"
  aral-wash: "#EEF3FB"
  aral-paper: "#FFFFFF"
typography:
  display:
    fontFamily: "Archivo, Inter, ui-sans-serif, sans-serif"
    fontSize: "clamp(3.25rem, 6.6vw, 7.25rem)"
    fontWeight: 900
    lineHeight: 0.88
    letterSpacing: "-0.02em"
    fontVariation: "\"wdth\" 112"
  title:
    fontFamily: "Archivo, Inter, ui-sans-serif, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.33
    letterSpacing: "-0.025em"
    fontVariation: "\"wdth\" 108"
  foot:
    fontFamily: "Archivo, Inter, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "0.08em"
    fontVariation: "\"wdth\" 112"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  action:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
  note:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.375
rounded:
  box: "3px"
  segment: "2px"
  pip: "9999px"
spacing:
  label-gap: "6px"
  stack: "20px"
  box-inset-sm: "20px"
  box-inset: "28px"
  gutter-xs: "16px"
  gutter-sm: "24px"
  gutter-lg: "40px"
  gutter-xl: "64px"
  gutter-2xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.aral-gold}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.action}"
    rounded: "{rounded.box}"
    height: "48px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.aral-sun}"
    textColor: "{colors.aral-navy}"
  button-primary-disabled:
    backgroundColor: "{colors.aral-wash}"
    textColor: "{colors.aral-slate}"
  segment-track:
    backgroundColor: "{colors.aral-paper}"
    rounded: "{rounded.box}"
    padding: "4px"
  segment-on:
    backgroundColor: "{colors.aral-gold}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.segment}"
    height: "40px"
  segment-on-ink:
    backgroundColor: "{colors.aral-navy}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.segment}"
    height: "40px"
  segment-off:
    textColor: "{colors.aral-slate}"
    typography: "{typography.label}"
    rounded: "{rounded.segment}"
    height: "40px"
  segment-off-hover:
    backgroundColor: "{colors.aral-wash}"
    textColor: "{colors.aral-navy}"
  input-field:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.box}"
    height: "48px"
    padding: "0 14px"
  label-box:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    rounded: "{rounded.box}"
    width: "464px"
    padding: "28px"
  label-box-header:
    backgroundColor: "{colors.aral-navy}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.title}"
    padding: "16px 28px"
  step-pip-current:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    rounded: "{rounded.pip}"
    size: "20px"
  title-band:
    backgroundColor: "{colors.aral-blue}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.display}"
  cover-foot:
    backgroundColor: "{colors.aral-navy}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.foot}"
    padding: "12px 0"
    width: "100%"
  context-row:
    backgroundColor: "{colors.aral-wash}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.box}"
    padding: "10px 14px"
  link:
    textColor: "{colors.aral-blue}"
    typography: "{typography.label}"
---

# Design System: LITRACK Sign-in

> **Scope.** This document records the sign-in surface only: `/login` and `/admin/login`, built from `src/components/auth/login-shell.tsx`, `src/components/auth/auth-card.tsx`, `src/components/forms/login-form.tsx` and `src/components/forms/admin-login-form.tsx`. It does **not** describe the in-app UI. Dashboards, learners, terms reports and every other app-shell surface follow their own incumbent code-defined system (blue-gray field, white Surface panels, blue primary, amber secondary, violet reserved for ARAL; tokens in `src/app/globals.css` and `tailwind.config.ts`) until that system is documented separately. Nothing here overrides those tokens. The `aral-*` inks stay on the sign-in screens.

## Overview

**Creative North Star: "The Self-Learning Module Cover"**

Signing in opens your school's module. The screen is a printed DepEd Self-Learning Module cover in the ARAL Program's logo inks. A white masthead carries the ARAL and partner marks. A full-width royal-blue title band sets LITRACK in heavy expanded grotesque. The school illustration is the cover picture, and the sign-in form is set into the cover like the name label a learner fills in. A navy foot strip closes the cover with the agency credit. It is printed stock, not a lit screen. The inks are fixed, the corners are nearly square, the label box stands forward by overlap and a drawn navy edge rather than a shadow, and the page stays light whatever theme the app is set to (`ALWAYS_LIGHT_PATHS` in `src/lib/theme.ts`).

The surface rejects a frosted glass card floating over a photo. The school art is the cover picture: it sits in its own grid row, is never blurred or tinted behind the form, and the label box overlaps its edge the way a printed label overlaps cover art. Colour is flat, solid and taken from the ARAL logo, and each ink has a job. Gold is saved for what the teacher acts on next.

The label box shows the steps as fixed stations. A navy header names the step and, on the two-step school sign-in, a step rail (1 School, 2 Account) shows where the teacher is. Moving to the next step turns the label body in once rather than swapping in a new screen.

**Key Characteristics:**
- Flat offset-print inks sampled from the ARAL logo, fixed on the page and never themed.
- A royal-blue title band closed by a three-ink rule (red, navy, gold) under the cover title, the only place the ARAL letters' colours appear together.
- Archivo, stretched wide, used only for cover lettering: the LITRACK title, the label box header and the cover foot.
- Sun gold marks only the live choice: the picked role and the primary action.
- One label box with 3px corners and a 2px navy printed edge. It has no shadow, ring or lift.

## Colors

Full-saturation inks from the ARAL logo, laid flat on white stock. There are no gradients, and each ink has one job.

### Primary
- **Royal Title Blue** (aral-blue): the title band behind LITRACK, which runs the full width of the page on desktop. It is also the page's focus and selection ink, because the shell points the shared `--primary` and `--ring` at it (`213 98% 27%`). That makes it the colour of text links, the caret, field focus borders and focus rings.

### Secondary
- **Sun Gold** (aral-gold): the live control. It fills the primary action (Continue, Sign in, Create account) and the picked role on step one (Teachers or School Head). The only decorative use is the gold third of the ARAL-letter rule.
- **Deep Sun** (aral-sun): the primary action's hover. It is a state of gold, never a colour on its own.

### Tertiary
- **Letter Red** (aral-red): the red third of the ARAL-letter rule. Beyond that it appears only as a 30% edge on the page-level error notice.

### Neutral
- **Cover Navy** (aral-navy): all type on white stock, the label box header strip and its 2px edge, the cover foot strip, the navy third of the rule, and the picked option of any switch that is not the step-one role choice. Text on gold is navy too.
- **Stock White** (aral-paper): the page, the masthead, the label box body, the fields, and the lettering reversed out of blue and navy.
- **Print Slate** (aral-slate): secondary text such as field notes, placeholders (at full strength, about 5.9:1 on white), picker icons, off segments and the disabled primary's label.
- **Edge Blue-Grey** (aral-edge): the resting boundary of every control, meaning field strokes and segment tracks. At about 3.4:1 on white it meets the 3:1 WCAG 1.4.11 asks of a control boundary.
- **Rule Line** (aral-line): decorative hairlines only. It draws the masthead divider between the ARAL mark and the partner marks, the label box footer rule (at 60%) and the dashed empty-state box.
- **Wash** (aral-wash): the quiet fill for the step-two context row (the chosen school with "Change school"), the off-segment hover, and the disabled primary.

### Named Rules
**The One Cord Rule.** Gold goes only on what the teacher can act on next: the picked role on step one and the primary action. Every other switch marks its pick in navy ink, which is why the step-two intent switch (Have an account / Create account) goes navy and leaves gold to the submit. Never use gold for decoration, headings, icons or illustration. If a surface has two gold things that are not a choice and its confirmation, one of them is wrong.

**The Three-Ink Rule.** Red, navy and gold appear side by side exactly once, as equal thirds of the rule closing the title band: 6px on phones, 10px at `lg`. At `lg` the rule stays in the cover column and ends where the label column begins. It is the one ARAL-letter moment. Do not repeat it as a divider, a card edge or a loader.

**The Drawn Edge Rule.** A control's boundary is drawn in Edge Blue-Grey, never in Rule Line. Rule Line is too faint to mark something a teacher must find and press (about 1.7:1), so it stays on decoration.

**The Fixed Ink Rule.** Sign-in inks are literal values in the `aral` Tailwind palette, not theme tokens. Printed stock does not change with the room, so these screens never take `.dark`.

## Typography

**Display Font:** Archivo, variable width axis (with Inter, then ui-sans-serif). It is loaded through `next/font` inside `LoginShell` only, so no other surface pays for it.
**Body Font:** Inter (`--font-inter`, the app's face).

**Character:** Archivo, stretched wide at black weight, gives the heavy grotesque of a printed DepEd cover title. Inter carries every word the teacher reads or types, so the form reads like the rest of LITRACK once they are inside.

### Hierarchy
- **Display** (Archivo 900, wdth 112, clamp 3.25rem to 7.25rem, line-height 0.88, -0.02em): the LITRACK title, reversed white on the blue band. It is used once per page.
- **Title** (Archivo 800, wdth 108, 1.125rem on phones and 1.5rem from `sm`, tight tracking): the label box header ("Sign in", "Teacher sign in", "Super Admin sign-in"), white on navy.
- **Foot** (Archivo 600, wdth 112, 0.75rem on phones and 0.875rem from `sm`, uppercase, 0.08em, line-height 1.375): the cover foot credit only, white on navy.
- **Headline** (Inter 600, 1rem to 1.125rem to 1.5rem, line-height 1.375, max 30ch, balanced): the product line under the title on the band.
- **Body** (Inter 400, 1rem): field values and the band's supporting line. The supporting line uses line-height 1.625, a 52ch measure, and is hidden on phones.
- **Action** (Inter 700, 1rem): the primary action's label.
- **Label** (Inter 600, 0.875rem): field labels, segment labels (1rem from `sm`), the context row, footer links, and the step rail (at 0.75rem).
- **Note** (Inter 400, 0.875rem, line-height 1.375, slate): small print under a field.

### Named Rules
**The Cover Lettering Rule.** Archivo is for lettering printed on the cover: the LITRACK title, the label box header and the cover foot. Labels, values, buttons and notes stay in Inter.

**The Cover Foot Exception.** The only uppercase tracked line is the cover foot's agency credit, "Department of Education · Division of Sarangani". It mirrors the agency band along the bottom of a real module cover and closes the page. It labels nothing. Never place an uppercase tracked line above a heading, a field or the label box title.

## Layout

The cover is a CSS grid. On desktop (`lg`, 1024px) it has two columns, a flexible cover column beside an auto-width label column, and three rows: the band (auto height), the picture (at least 15rem, then filling the viewport) and the foot (auto). The blue band spans both columns in row one. Its three-ink rule sits at the bottom of the same cell but only in column one. The school art spans both columns in row two, cropped with `object-cover` at 45% / 72% so the school building and flag stay in frame. The label box (29rem wide) sits in column two and spans rows one and two, starting 40px below the band's top edge, so it straddles the band and the picture. The cover foot spans both columns in row three, left-aligned.

Below `lg` the grid collapses to one column. The band comes first with its full-width rule, then a fixed-height picture (208px, or 240px from `sm`). The label box goes full-width in row three, pulled up 32px (40px from `sm`) so it overlaps the picture's lower edge, with 40px below it. The cover foot closes the page in row four, centred, set as two deliberate lines on phones ("Department of Education" / "Division of Sarangani") and one line joined by a middle dot from `sm`.

The page gutter is shared by the masthead, the band, the label column and the cover foot so their edges line up: 16px, then 24px at `sm`, 40px at `lg`, 64px at `xl` and 96px at `2xl`. The masthead is a row with 12px vertical padding holding the ARAL mark (48 / 56 / 64px), a 1px rule-line divider and the partner strip (128 / 160 / 208px wide), with nothing on its right. Inside the label box, fields stack at 20px with 6px between label and field. The box insets 20px on phones and 28px from `sm`, and a footer row sits 24px below the form behind a hairline.

## Elevation & Depth

This is printed stock, so it is flat by default. Depth comes from overlap and drawn edges rather than lift. The label box sits across the band and the picture edge, and its 2px navy edge separates it from the art. It casts no shadow and has no ring. Two small soft navy shadows remain, both on controls. Neither is a glow and neither is a hard offset block.

### Shadow Vocabulary
- **Live control drop** (`box-shadow: 0 10px 22px -14px rgba(18,41,77,0.7)`): a short shadow under the enabled primary action. It is removed when the button is disabled.
- **Picked seat** (`box-shadow: 0 1px 2px rgba(18,41,77,0.25)`): the barest seat under the picked option in a segment switch, gold or navy.

### Named Rules
**The Printed Stock Rule.** No backdrop blur, no translucent panels, no coloured glows and no shadow on the label box. If something needs to stand forward, it overlaps and takes a drawn edge. It does not float.

## Shapes

The corners are nearly square. Every box uses 3px: the label box, fields and pickers, the primary action, segment tracks, the school context row, the error notice and the empty-state box. The segments inside a track use 2px. The only round forms are the 20px step pips. These radii are literal values on the sign-in constants, not the app's `--radius`, so an app radius change does not reach the cover.

Edges are drawn, because a printed answer box has a ruled edge. The label box has a 2px navy edge and clips its navy header to its corners. Fields and segment tracks have a 1.5px Edge Blue-Grey stroke. Decorative lines use Rule Line: the 1px masthead divider, the 1px footer hairline at 60%, and the 1.5px dashed empty-state box. The rule under the band is a hard-edged bar split into thirds.

## Components

### Buttons
The one live control. The button is full-width, confident and gold.
- **Shape:** nearly square (3px), 48px tall and full width inside the label box.
- **Primary:** navy label on sun gold with a trailing arrow icon (20px), plus the live-control drop.
- **Hover / Focus:** the fill deepens to Deep Sun. Focus shows a 2px royal-blue ring at a 2px offset.
- **Disabled:** a Wash fill with a slate label and no shadow, at full opacity so the label stays readable. Continue stays disabled until a school is picked.
- **Loading:** the label changes to "Signing in…" or "Creating account…". The button does not change size.

### Segment switch
A two-way choice printed as a track.
- **Style:** a 1.5px Edge Blue-Grey track with 3px corners and 4px inner padding, holding two equal 40px segments with 2px corners. Role segments carry 18px leading icons.
- **Role pick (step one, Teachers / School Head):** the picked segment is gold with a navy label and the picked seat. This is the choice the Continue button confirms.
- **Intent pick (step two, Have an account / Create account):** the picked segment is navy with a white label and the picked seat, so gold stays on the submit.
- **Off:** transparent with a slate label. On hover it takes the Wash fill with a navy label. A locked option (Teachers before the school opens to them) is disabled, and a slate note with a lock icon explains why.

### Label box (signature component)
The name label set into the cover.
- **Corner Style:** nearly square (3px) and clipped.
- **Background:** a navy header strip (the Title style, 16px vertical padding) over a white body.
- **Edge:** a 2px navy printed edge. It has no shadow, ring or lift (see Elevation & Depth).
- **Internal Padding:** 20px on phones, 28px from `sm` (24px / 28px vertical in the body).
- **Step rail:** on the school sign-in, the header's right side holds two 20px round pips with labels, all in 0.75rem type. The current pip is white with navy numerals and its label is white. Other pips are outlined in a light navy tint. A finished step shows a check instead of its number. On phones only the current step is named. Admin sign-in has one step, so it shows no rail.
- **Step turn:** each step's body enters once with `module-turn`: 420ms, `cubic-bezier(0.16, 1, 0.3, 1)`, starting from 35% opacity and 12px to the right. Because it starts already visible, content is never hidden, and it runs only under `motion-safe`.
- **Footer:** a hairline row with Forgot password? on the left and the other sign-in (Super Admin or School) on the right in slate.

### Inputs / Fields
Printed answer boxes.
- **Style:** white fill, a 1.5px Edge Blue-Grey stroke, 3px corners, 48px height, 14px side padding, and navy 1rem text. Placeholders are full slate. Pickers (District, School Name) share the same box with a 20px slate leading icon and a down chevron.
- **Hover:** the stroke moves toward blue (royal blue at 60%).
- **Focus:** the stroke becomes royal blue, with a 2px royal-blue ring at a 2px offset.
- **Error:** the stroke and ring switch to the app's destructive red through `aria-invalid`, with the message printed under the field.

### Context row
On step two a Wash row (3px corners, 10px by 14px) names the chosen school in navy with a slate school icon. A "Change school" text button in royal blue returns the teacher to step one.

### Cover foot
A full-width navy strip that closes the cover, with 12px vertical padding and the page gutter. It carries the agency credit in the Foot style, white. It is the only uppercase tracked text on the surface (see the Cover Foot Exception).

### Links
Royal blue, 600 weight, with an underline at 30% blue and a 4px offset. On hover the underline turns full blue. The secondary footer link is slate, turns navy on hover, and underlines only on hover.

## Do's and Don'ts

### Do:
- **Do** print every sign-in screen with `LoginShell` and `AuthCard`, and build their controls from the `AUTH_*` class constants in `auth-card.tsx` rather than restyling shadcn primitives inline.
- **Do** keep gold on the live choice only: the picked role and the primary action, per the One Cord Rule. Mark any other switch's pick in navy ink (`AUTH_SEGMENT_ON_INK`).
- **Do** close the blue band with the red / navy / gold rule, once: 6px on phones, 10px at `lg`, and confined to the cover column at `lg`.
- **Do** keep the school art in its own grid row as the cover picture, and let the label box overlap its edge.
- **Do** draw control boundaries in Edge Blue-Grey (1.5px) and keep Rule Line for decorative hairlines.
- **Do** keep these paths in `ALWAYS_LIGHT_PATHS`, and repoint `--primary` and `--ring` at royal blue inside the shell so shared controls print in the cover's ink.
- **Do** keep type on white in navy or slate, and on blue or navy in white. Put navy text on gold.

### Don't:
- **Don't** apply these inks, Archivo or the cover layout to app-shell surfaces. The app has its own incumbent system in `src/app/globals.css`.
- **Don't** put the form in a translucent or blurred panel over the photo, and don't blur or tint the school art behind it.
- **Don't** give the label box a shadow, ring or hover lift. Its 2px navy edge is its depth.
- **Don't** use gradients, glows or coloured shadows on interface surfaces. The school illustration is painted art and is exempt, but UI is flat ink.
- **Don't** round corners past 3px on boxes or 2px on segments.
- **Don't** spend violet here. Violet is the app's ARAL accent token; the cover speaks in the ARAL logo's own inks.
- **Don't** set labels, values or buttons in Archivo, or letter the cover in a system display face.
- **Don't** add uppercase tracked lines above headings, fields or the label box title. The cover foot credit is the only uppercase tracked text, and it is not a pattern.
- **Don't** repeat the three-ink rule as a divider, border or progress bar.
