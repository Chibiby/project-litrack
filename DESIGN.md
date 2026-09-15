---
name: LITRACK Sign-in
description: The sign-in surface (/login, /admin/login) as a warm storybook page opening on the school, in the ARAL logo inks.
colors:
  aral-blue: "#013E88"
  aral-navy: "#12294D"
  aral-gold: "#FED110"
  aral-sun: "#FFBA04"
  aral-red: "#E90423"
  aral-slate: "#4C6971"
  aral-edge: "#7B8CA6"
  aral-line: "#B8C6DA"
  aral-cloud: "#C7E0FA"
  aral-sky: "#E3F0FD"
  aral-sunlight: "#FFF4C2"
  aral-wash: "#EEF3FB"
  aral-paper: "#FFFFFF"
typography:
  display:
    fontFamily: "Baloo 2, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3.5rem, 6.5vw, 6.5rem)"
    fontWeight: 800
    lineHeight: 0.88
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Baloo 2, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  action:
    fontFamily: "Baloo 2, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    lineHeight: 1.55
  tile:
    fontFamily: "Baloo 2, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.5
  foot:
    fontFamily: "Baloo 2, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.375
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
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
  pill:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1
rounded:
  control: "16px"
  page-sm: "24px"
  page: "28px"
  pill: "9999px"
spacing:
  label-gap: "6px"
  tile-gap: "12px"
  stack: "20px"
  card-inset-sm: "20px"
  card-inset: "28px"
  card-overlap: "32px"
  stage-gap: "40px"
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
    rounded: "{rounded.pill}"
    height: "56px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.aral-sun}"
    textColor: "{colors.aral-navy}"
  button-primary-disabled:
    backgroundColor: "{colors.aral-wash}"
    textColor: "{colors.aral-slate}"
  tile-on:
    backgroundColor: "{colors.aral-gold}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.tile}"
    rounded: "{rounded.control}"
    height: "56px"
  tile-on-ink:
    backgroundColor: "{colors.aral-blue}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.tile}"
    rounded: "{rounded.control}"
    height: "56px"
  tile-off:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.tile}"
    rounded: "{rounded.control}"
    height: "56px"
  tile-off-hover:
    backgroundColor: "{colors.aral-sky}"
    textColor: "{colors.aral-navy}"
  input-field:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "48px"
    padding: "0 16px"
  story-card:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    rounded: "{rounded.page}"
    width: "480px"
    padding: "28px"
  story-card-header:
    backgroundColor: "{colors.aral-sunlight}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.title}"
    padding: "16px 28px"
  step-pill-current:
    backgroundColor: "{colors.aral-gold}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.pill}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  step-pill-done:
    backgroundColor: "{colors.aral-blue}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.pill}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  step-pill-upcoming:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-slate}"
    typography: "{typography.pill}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  title-page:
    backgroundColor: "{colors.aral-paper}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.display}"
    rounded: "{rounded.page}"
    padding: "28px 32px"
  arch-window:
    backgroundColor: "{colors.aral-sky}"
    width: "264px"
    height: "208px"
  footer-strip:
    backgroundColor: "{colors.aral-navy}"
    textColor: "{colors.aral-paper}"
    typography: "{typography.foot}"
    padding: "12px 0"
    width: "100%"
  context-row:
    backgroundColor: "{colors.aral-wash}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  notice:
    backgroundColor: "{colors.aral-wash}"
    textColor: "{colors.aral-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  link:
    textColor: "{colors.aral-blue}"
    typography: "{typography.label}"
---

# Design System: LITRACK Sign-in

> **Scope.** This document covers the sign-in surface only: `/login` and `/admin/login`. Those screens are built from `src/components/auth/login-shell.tsx`, `src/components/auth/auth-card.tsx`, `src/components/auth/story-doodles.tsx`, `src/components/forms/login-form.tsx` and `src/components/forms/admin-login-form.tsx`. It does **not** describe the in-app UI. Dashboards, learners, terms reports and every other app-shell surface keep their own system, defined in code (blue-gray field, white Surface panels, blue primary, amber secondary, violet reserved for ARAL; tokens in `src/app/globals.css` and `tailwind.config.ts`), until someone documents it separately. Nothing here overrides those tokens. The `aral-*` inks, Baloo 2 and the storybook shapes stay on the sign-in screens.

## Overview

**Creative North Star: "Storybook, warm"**

Signing in feels like opening a friendly picture book from school. It is bright, rounded and chunky, and it is still plainly a teachers' tool underneath. A paper masthead carries the ARAL and partner marks. Below it, a pale-sky stage opens on the school illustration. LITRACK is lettered in rounded Baloo 2 on a paper title page with a red hand-drawn squiggle. The school's learners look out of an arched window over the art. The sign-in card rides near the top of the stage, with a pale-sunshine header and a gold Continue as its one live action. A navy strip closes the page with the agency credit.

The palette is the ARAL logo's inks, used lighter and more generously than before. Pale sky (`aral-sky`), cloud (`aral-cloud`) and sunlight (`aral-sunlight`) tints carry the big fields, and full-strength blue, navy and sun gold carry the ink. Depth works like a stack of picture books. Everything that stands forward has a thick navy or paper rim and a solid navy offset straight down, never a soft glow. The page stays light whatever theme the app is set to (`ALWAYS_LIGHT_PATHS` in `src/lib/theme.ts`), so its inks are literal values, not theme tokens.

The card shows the sign-in as a short story told in steps. The header names the step. On the two-step school sign-in, a row of pills (School, then Account) shows where the teacher is. The next step's body pops in once rather than swapping in a new screen.

**Key Characteristics:**
- ARAL logo inks over pale sky, cloud and sunlight tints, fixed on the page and never themed.
- Baloo 2, a rounded display face, letters LITRACK, the card title, the primary action, the choice tiles and the footer credit. Inter carries everything the teacher reads closely or types.
- Chunky rounded forms: 16px controls, 24 to 28px pages, full-round pills and primary action.
- Stacked-book depth: 2 to 3px navy rims with solid navy offsets straight down (3, 4 or 6px), and no blur anywhere.
- Two authored doodles and no others: a gold sun and a red squiggle.

## Colors

The ARAL logo inks at full strength, over pale sky and sunshine tints. Each ink has a job, and there are no gradients on the interface.

### Primary
- **Royal Blue** (aral-blue): the page's focus and selection ink. The shell points the shared `--primary` and `--ring` at it (`213 98% 27%`), and it sets the caret colour, so it colours text links, field focus borders and focus rings. It also fills the picked intent tile on step two and the finished step's pill. White on blue is about 10.3:1.

### Secondary
- **Sun Gold** (aral-gold): where the teacher is and what they do next. It fills the primary action, the picked role tile on step one and the current step's pill. It is also the face of the sun doodle.
- **Deep Sun** (aral-sun): the primary action's hover. It is a state of gold, never a colour on its own.

### Tertiary
- **Letter Red** (aral-red): the squiggle over LITRACK, and nothing else on the surface. Field errors use the app's own destructive red through `aria-invalid`, not this ink.

### Neutral
- **Story Navy** (aral-navy): all type on light grounds, the card's 3px rim and header rule, every rim on a picked or pressable object, all offset shadows, the notice rim, the doodle outlines and the footer strip. Text on gold and on sunlight is navy (about 9.9:1 and 13.1:1).
- **Paper** (aral-paper): the masthead, the title page (at 90%), the card body, fields, off tiles, the arch window's 4px rim and the lettering reversed out of blue and navy.
- **Sky** (aral-sky): the page ground under and around the art, the arch window's fill behind the learners, and the off tile's hover.
- **Cloud** (aral-cloud): soft decorative rims only. It draws the masthead's 2px underline, the title page's 2px rim and the card footer's 2px dashed divider. At about 1.4:1 on white it can never mark a control.
- **Sunlight** (aral-sunlight): the card header's ground, and only that.
- **Slate** (aral-slate): secondary text such as field notes, placeholders (about 5.9:1 on white), picker and row icons, the upcoming step pill, the secondary footer link and the disabled primary's label.
- **Edge Blue-Grey** (aral-edge): the resting boundary of every control: fields, pickers, off tiles, the upcoming step pill, the disabled primary and the empty-state box. At about 3.4:1 on white it meets the 3:1 WCAG 1.4.11 asks of a control boundary.
- **Rule Line** (aral-line): the 1px divider between the ARAL mark and the partner marks in the masthead.
- **Wash** (aral-wash): quiet fills for the step-two context row (the chosen school with "Change school"), the page-level notice and the disabled primary.

### Named Rules
**The Sunshine Rule.** Gold marks where the teacher is and what they press next: the current step pill, the picked role, the primary action and the sun doodle's face. A picked sub-choice (step two's Have an account / Create account) goes blue, so gold is not spent twice in one decision. Never use gold for headings, text, rims, backgrounds or illustration fills. The warm ground in the card header is Sunlight, not gold.

**The Drawn Edge Rule.** A control's resting boundary is Edge Blue-Grey. Once it is picked or pressable, the rim turns navy. Cloud and Rule Line are decoration: they rim pages, underline the masthead and divide the card footer. They are too faint (under 1.5:1) to mark something a teacher must find and press.

**The One Squiggle Rule.** Red appears once, as the hand-drawn squiggle on the title page. Do not reuse it as a divider, an underline for other headings or a loader.

**The Fixed Ink Rule.** Sign-in inks are literal values in the `aral` Tailwind palette, not theme tokens. The storybook does not change with the room, so these screens never take `.dark`.

## Typography

**Display Font:** Baloo 2, weights 600, 700 and 800 (falling back to ui-sans-serif and system-ui). It loads through `next/font` inside `LoginShell` as `--font-story` (Tailwind `font-story`), so no other surface pays for it.
**Body Font:** Inter (`--font-inter`, the app's face).

**Character:** Baloo 2's round, heavy letters give the book its friendly, spoken voice. Inter carries every field, label and note, so what the teacher reads closely looks like the rest of LITRACK once they are inside.

### Hierarchy
- **Display** (Baloo 2 800, line-height 0.88, -0.02em at `lg`; phones set clamp 2rem to 2.75rem at line-height 0.9 and -0.01em): LITRACK on the title page, navy. It is used once per page.
- **Title** (Baloo 2 800, 1.25rem on phones and 1.5rem from `sm`, tight tracking): the card title ("Sign in", "Teacher sign in", "School Head sign in", "Create teacher account"), navy on sunlight, led by the sun doodle.
- **Action** (Baloo 2 800, 1.125rem): the primary action's label.
- **Tile** (Baloo 2 700, 1rem): the labels of the two-way choice tiles.
- **Foot** (Baloo 2 600, 0.875rem on phones and 1rem from `sm`, sentence case): the footer credit only, white on navy.
- **Headline** (Inter 600, 0.875rem on phones and 1.25rem at `lg`, line-height 1.375, balanced): the product line under LITRACK.
- **Body** (Inter 400, 1rem): field values. At `lg` only, the title page's supporting line uses 1.125rem, line-height 1.625 and navy at 80% (about 7.7:1).
- **Label** (Inter 600, 0.875rem): field labels, the context row, the notice and footer links.
- **Note** (Inter 400, 0.875rem, line-height 1.375, slate): small print under a field.
- **Pill** (Inter 700, 0.75rem, tabular numerals): the step pills.

### Named Rules
**The Storybook Voice Rule.** Baloo 2 is for what the book says aloud: LITRACK, the card title, the primary action, the choice tiles and the footer credit. Labels, values, notes, links and step pills stay in Inter.

**The Sentence Case Rule.** Nothing on the surface is set in tracked uppercase, not even the footer credit. Never place an uppercase tracked line above a heading, a field or the card title.

## Layout

The page is a vertical flex column at least one viewport tall: masthead, then stage, then footer strip. The masthead, stage and footer share one page gutter so their edges line up: 16px, then 24px at `sm`, 40px at `lg`, 64px at `xl` and 96px at `2xl`. One DOM tree serves every width. Only CSS changes between phone and desktop, so the form never renders twice.

**Masthead.** A paper row with 12px vertical padding and a 2px Cloud underline. It holds the ARAL mark (48, 56 or 64px tall), a 1px Rule Line divider and the partner strip (128, 160 or 208px wide), with nothing on its right.

**Stage, desktop (`lg`, 1024px).** A two-column grid: a flexible title column beside a 30rem card column, with a 40px gap, 40px top padding and 48px bottom padding. The school illustration (`login-bg.webp`) fills the whole stage behind both columns, cropped with `object-cover` at 45% / 30%. The title column holds the title page (up to 36rem wide), with the arch window 40px below it (264 by 208px, or 304 by 240px at `xl`). The card sits in the second column, 24px down from the top of the stage.

**Stage, phones.** One column. The illustration becomes a 224px strip (256px from `sm`) cropped at 50% / 20%, and the title column matches its height. The title page is at most 62% wide at the top left. The arch window is anchored at the bottom right of the strip (112 by 96px, or 128 by 112px from `sm`), kept clear of the zone the card overlaps. The card follows full-width and is pulled up 32px so it overlaps the bottom of the strip, with 40px below it.

**Inside the card.** The header insets 20px (28px from `sm`) with 16px vertical padding. The body insets 20px by 24px on phones and 28px from `sm`. Fields stack at 20px, with 6px between label and field. Choice tiles sit in two columns with a 12px gap, and the register name fields pair up at 16px from `sm`. The footer row sits 24px below the form, behind a dashed divider with 16px above the links.

**Footer strip.** Full width, navy, 12px vertical padding. On phones it is centred and set as two deliberate lines ("Department of Education" / "Division of Sarangani"). From `sm` it runs on one line joined by a middle dot, and at `lg` it is left-aligned.

## Elevation & Depth

Depth is stacked picture books. An object that stands forward gets a rim (navy, or the arch window's paper) and a solid navy offset straight down, with no blur and no spread. Offsets get deeper with importance. The rest of the page is flat: the masthead, title page, fields, notices and footer strip cast nothing, and nothing on the surface uses backdrop blur or a coloured glow.

### Shadow Vocabulary
- **Book stack** (`box-shadow: 0 6px 0 0 #12294D`): the sign-in card and the arch window, the two objects set on the page.
- **Live press** (`box-shadow: 0 4px 0 0 #12294D`): the enabled primary action at rest. It deepens to `0 6px 0 0 #12294D` while the button lifts 2px on hover, and shrinks to `0 2px 0 0 #12294D` while it sinks 2px on press. It is removed when the button is disabled.
- **Picked seat** (`box-shadow: 0 3px 0 0 #12294D`): the picked choice tile, gold or blue.

### Named Rules
**The Stacked Book Rule.** Every shadow is a solid navy offset straight down (0 X 0 0) under an object with a drawn rim, at 3, 4 or 6px. There are no soft or blurred shadows, no glows, no sideways or diagonal offsets, and no offset under an unrimmed shape. If something new needs to stand forward, give it a rim and one of these three depths.

## Shapes

The forms are chunky and round. Controls use 16px corners: fields, pickers, choice tiles, the context row, the notice and the empty-state box. The card uses 28px. The title page uses 24px on phones and 28px at `lg`. The primary action and step pills are fully round. The arch window has a fully round top over 24px bottom corners, so it reads as an arched school window. These radii are literal values in the sign-in classes, not the app's `--radius`, so a change to the app radius does not reach the storybook.

The strokes are thick, like a picture book's outlines. The card has a 3px navy rim, and a 3px navy rule under its header. The primary action, choice tiles, step pills and notice have 2px rims. Fields have a 2px Edge Blue-Grey stroke. The arch window has a 4px paper rim. Decorative strokes are 2px Cloud (the masthead underline, the title page rim and the dashed card-footer divider) and the 1px masthead divider in Rule Line. The empty-state box is dashed 2px Edge Blue-Grey.

### Doodles
Two authored SVG motifs (`story-doodles.tsx`), both `aria-hidden` and unfocusable:
- **Sun:** a gold disc with a 2.5px navy outline and eight round-cap navy rays. It leads every card title (28px, or 32px from `sm`). At `lg` a second sun sits on the arch window's top-right shoulder (48px). On phones that second sun is hidden, so no more than two doodles are visible at once.
- **Squiggle:** a red hand-drawn wave at stroke width 5 with round caps, stretched above LITRACK on the title page (64 by 12px on phones, 160 by 16px at `lg`). It is used once.

## Components

### Buttons
The one live action: round, gold and pressable like a sticker on the page.
- **Shape:** fully round and full width inside the card. It is 52px tall on phones and 56px from `sm`.
- **Primary:** navy Baloo 2 label on sun gold, with a 2px navy rim, the live press offset and a trailing 20px arrow icon.
- **Hover:** the fill deepens to Deep Sun. Under `motion-safe` the button lifts 2px as its offset deepens to 6px, and the arrow nudges 3px forward (`story-nudge`, 600ms ease-in-out). Transitions run for 150ms on transform, box-shadow and background colour.
- **Active:** the button sinks 2px as its offset shrinks to 2px.
- **Focus:** the shared 2px royal-blue focus ring.
- **Disabled:** a Wash fill, a slate label and an Edge Blue-Grey rim, with no offset and no lift, at full opacity so the label stays readable. Continue stays disabled until a school is picked.
- **Loading:** the label changes to "Signing in…" or "Creating account…". The button does not change size.

### Choice tiles
A two-way choice set as two standalone tiles, not a track.
- **Style:** two equal 56px tiles with a 12px gap, 16px corners, 2px rims and Baloo 2 700 labels. Role tiles carry 20px leading icons.
- **Role pick (step one, Teachers / School Head):** the picked tile is gold, with a navy rim, a navy label and the picked seat. This is the choice Continue confirms.
- **Intent pick (step two, Have an account / Create account):** the picked tile is royal blue, with a navy rim, a white label and the picked seat, so gold stays on the submit.
- **Off:** paper with an Edge Blue-Grey rim and a navy label at 80%. On hover it takes the Sky fill and a blue rim at 50%. A locked option (Teachers before the school opens to them) is disabled, and a slate note with a lock icon explains why.

### Story card (signature component)
The picture-book page the teacher fills in.
- **Corner Style:** round (28px) and clipped. It is full width on phones and 30rem at `lg`.
- **Background:** a Sunlight header, separated by a 3px navy rule, over a paper body.
- **Rim and depth:** a 3px navy rim over the book-stack offset (see Elevation & Depth).
- **Header:** the sun doodle, then the card title in Baloo 2 navy. On the school sign-in the step pills sit on the right.
- **Step pills:** each pill is fully round with a 2px rim and 4px by 10px padding, and holds a 16px round numeral seat and a label. The current pill is gold with a navy rim, and its numeral sits on paper. A finished pill is royal blue with a navy rim, and shows a blue check on a paper seat instead of its number. An upcoming pill is paper with an Edge Blue-Grey rim and a slate label. On phones only the current step is named; the others keep their label for screen readers. Admin sign-in has one step, so it shows no pills.
- **Step pop:** each step's body enters once with `story-pop`: 260ms ease-out, starting from 60% opacity, 6px low and at 98.5% scale. Because it starts already visible, content is never hidden, and it runs only under `motion-safe`.
- **Footer:** a dashed Cloud divider, with Forgot password? on the left and the other sign-in (Super Admin or School) on the right in slate.

### Inputs / Fields
Rounded answer boxes.
- **Style:** a paper fill, a 2px Edge Blue-Grey stroke, 16px corners, 48px height, 16px side padding and navy 1rem text. Placeholders are full slate. Pickers (District, School Name) share the same box, with a 20px slate leading icon and a down chevron.
- **Hover:** the stroke moves toward blue (royal blue at 60%).
- **Focus:** the stroke becomes royal blue, with a soft 4px blue halo at 15%. The blue stroke is the actual focus indicator; the halo only softens it.
- **Error:** the stroke and ring switch to the app's destructive red through `aria-invalid`, with the message printed under the field. Session-end errors arrive as a toast.

### Context row and notice
- **Context row:** on step two a Wash row (16px corners, 10px by 14px) names the chosen school in navy, with a slate school icon. A "Change school" text button in royal blue returns the teacher to step one.
- **Notice:** a page-level message (for example, when the school list cannot load) is a Wash box with a 2px navy rim, 16px corners and navy 600 text.
- **Empty state:** "No schools found" sits in a dashed 2px Edge Blue-Grey box in slate.

### Title page and arch window
- **Title page:** paper at 90% over the art with a 2px Cloud rim, holding the squiggle, LITRACK and the product line (plus the supporting line at `lg`). It casts no shadow. The art is never blurred behind it.
- **Arch window:** the learners (`login-learners.webp`) in a Sky-filled arch with a 4px paper rim and the book-stack offset, cropped at 50% / 85%. At `lg` a sun doodle sits on its shoulder.

### Links
Royal blue, 600 weight, with a 2px underline at 30% blue and a 4px offset. On hover the underline turns full blue. The secondary footer link is slate, turns navy on hover, and is underlined only on hover.

### Assets and provenance
- `public/brand/login-bg.webp` (1672 by 941): the school illustration behind the stage. It arrived with the owner's v2 sign-in mockup in `6b59e7d`.
- `public/brand/login-learners.webp` (650 by 470): a crop of the learners from the owner-supplied banner `public/brand/banner-learner.png` (2172 by 579). The crop is flattened on Sky (#E3F0FD), so its transparent areas match the arch window's fill. Re-crop from that source if the art changes, and flatten on the same ink.

## Do's and Don'ts

### Do:
- **Do** build every sign-in screen with `LoginShell` and `AuthCard`, and style their controls with the `AUTH_*` class constants in `auth-card.tsx` rather than restyling shadcn primitives inline.
- **Do** keep gold on where the teacher is and what they press next (current step, picked role, primary action), per the Sunshine Rule. Mark a sub-choice's pick in royal blue (`AUTH_SEGMENT_ON_INK`).
- **Do** give anything that stands forward a rim and one of the three navy offsets (3, 4 or 6px, straight down), per the Stacked Book Rule.
- **Do** draw resting control boundaries in 2px Edge Blue-Grey, and turn the rim navy only when a control is picked or pressable.
- **Do** keep pale tints (Sky, Cloud, Sunlight) for grounds and decorative rims, and full-strength inks for type, rims and the live action.
- **Do** keep these paths in `ALWAYS_LIGHT_PATHS`, and repoint `--primary` and `--ring` at royal blue inside the shell so shared controls use the book's ink.
- **Do** keep type on light grounds in navy or slate, and on blue or navy in white. Put navy text on gold and sunlight.
- **Do** keep every doodle `aria-hidden`, and show no more than two at once on phones.

### Don't:
- **Don't** apply these inks, Baloo 2, the storybook shapes or the offset shadows to app-shell surfaces. The app has its own system in `src/app/globals.css`.
- **Don't** blur or tint the school art, or put a control on a translucent panel over it.
- **Don't** use soft, blurred or coloured shadows or glows, and don't offset diagonally. Depth is a solid navy offset straight down.
- **Don't** use gradients on interface surfaces. The school illustration and the learners are painted art and are exempt.
- **Don't** set square or near-square corners. Controls start at 16px.
- **Don't** add doodles beyond the sun and the squiggle, or repeat the squiggle.
- **Don't** spend violet here. Violet is the app's ARAL accent token; the storybook uses the ARAL logo's own inks.
- **Don't** set labels, values, notes or step pills in Baloo 2, or letter the page in a system display face.
- **Don't** add uppercase tracked lines anywhere on the surface.
