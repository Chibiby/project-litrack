# Design system tokens

The rules every class string in `src/` follows. `npm run lint` warns on the
common breaks (`litrack/design-tokens` in `eslint.config.mjs`); a one-off with
a real reason can stay, with an inline disable that says why.

Values live in two places that must agree: `tailwind.config.ts` (the class
names) and `src/app/globals.css` (the CSS variables, light and dark).

## Colour: by meaning, not by family

| Name      | Was      | Use for                                   |
| --------- | -------- | ----------------------------------------- |
| `aral`    | violet   | the ARAL accent, and only ARAL            |
| `warning` | amber    | needs attention, pending, caution         |
| `success` | emerald  | done, saved, on track                     |
| `danger`  | rose     | missing, failed, behind                   |
| `info`    | sky      | neutral notices                           |

Each keeps its full numbered scale with the exact old values
(`bg-warning-50`, `text-aral-700`), so nothing changed on screen when the names
moved. Two theme-aware names need no `dark:` class:

- `text-<meaning>-strong`: text in that colour, 700 in light and 200 in dark.
  Use it instead of `text-X-700 dark:text-X-200`.
- `aral` also has `DEFAULT`, `foreground`, `soft` and `soft-foreground`, from
  the `--aral*` variables.

Blue stays `primary`, red stays `destructive`; slate and the other families
are neutral greys and one-offs, not meanings.

## Glass

Three shared classes, in the components layer (a utility on the same element
still wins):

- `.icon-glass`: the tile behind an icon. Uncoloured; the icon carries the
  tone through `text-<meaning>-strong`.
- `.glass-card`: a page-level card (`Card`, `Surface`, summary cards).
- `.glass-panel`: app chrome and large panels (header, sidebar, calendar).

Blur strengths: `backdrop-blur-md` (12px) for panels and controls,
`backdrop-blur-xl` (24px) for page-level glass. No other strengths.

Card see-through levels: `bg-card/45` (dark glass), `bg-card/55` (light
glass), `bg-card/90` (nearly solid). No others.

On a touch phone narrower than 768px, cards
and icon tiles drop their blur for a near-solid fill (globals.css). The
header, sidebar and dialog overlays keep theirs.

## Shadows

Named in `tailwind.config.ts`. The ones that change in dark mode read a CSS
variable, so no `dark:shadow-…` is needed:

| Class               | For                                      |
| ------------------- | ---------------------------------------- |
| `shadow-card`       | a resting card                           |
| `shadow-glass`      | glass chrome (header, sidebar, panels)   |
| `shadow-raised`     | a raised summary/list card               |
| `shadow-lift`       | the hover or focus lift of a card        |
| `shadow-pressed`    | a card while pressed                     |
| `shadow-float`      | a floating panel (popover-like)          |
| `shadow-control`    | a glass control (account button)        |
| `shadow-field`      | a glass input                            |
| `shadow-indicator`  | the sidebar's active pill                |
| `shadow-highlight`, `shadow-highlight-soft` | a top inner highlight |
| `shadow-rule-b`, `shadow-rule-r` | a hairline drawn as a shadow |
| `shadow-auth*`      | the sign-in card and its fields only     |

## Corners

- `rounded-lg`: cards, panels, dialogs, tables.
- `rounded-md`: controls (buttons, inputs, selects, small chips in a row).
- `rounded-full`: pills, badges, avatars, dots.
- `rounded-xl` / `rounded-2xl`: app chrome only (header, sidebar, the glass
  account button), which sits a step outside the cards.

## Motion

| Duration        | Value | For                                    |
| --------------- | ----- | -------------------------------------- |
| `duration-fast` | 150ms | colour, opacity, small state changes   |
| `duration-base` | 220ms | most transitions                       |
| `duration-slow` | 420ms | page and step slides, larger moves     |

| Curve           | For                                            |
| --------------- | ---------------------------------------------- |
| `ease-standard` | most UI changes (decelerates, no overshoot)    |
| `ease-slide`    | page and step slides (the sign-in step slide)  |
| `ease-bounce`   | a small overshoot for a success pop            |

These work for `animate-in` too (tailwindcss-animate reads the named tokens;
it ignores arbitrary `duration-[…]`). Script that cannot read CSS variables
(the Web Animations API, inline `style.transition`) imports `MOTION_MS` and
`EASE` from `src/lib/ui/motion.ts`. The theme switch's circle
(`theme-waves.ts`) keeps its own curve on purpose.

Never `transition-all`: name the properties that change
(`transition-[width,background-color]`).

Parent and child pages slide like the sign-in steps through `PageSlide` and
`PageNavLink` (`src/components/ui/page-slide.tsx`): the Division Summary and
Super Admin Learners use it today.

## Sizes

`text-2xs` (11px) and `text-caption` (13px) replace `text-[11px]` and
`text-[13px]`. Widths in rem use the spacing scale (`max-w-64`, not
`max-w-[16rem]`).
