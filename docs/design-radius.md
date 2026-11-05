# Corner radius system

Corners are a system, not one value everywhere. Use the Tailwind tokens below; do not hard-code a pixel radius or an arbitrary `rounded-[...]` value.

## Token values

Defined in `tailwind.config.ts` from `--radius` (0.75rem, set in `src/app/globals.css`).

| Token | Value | Formula |
| --- | --- | --- |
| `rounded-sm` | 4px | `--radius - 8px` |
| `rounded-md` | 8px | `--radius - 4px` |
| `rounded-lg` | 12px | `--radius` |
| `rounded-xl` | 16px | `--radius + 4px` |
| `rounded-full` | 9999px | Tailwind default |

`rounded-2xl` and `rounded-3xl` are not part of the scale. Do not use them.

## Rules

1. Radius follows size. Small things get small corners, big surfaces get big ones.
2. Nested corners: inner radius = outer radius minus the padding between them. This applies when the inner element sits in the container's corner region (a tray, footer band, inset image, or highlighted item inside a menu). Example: a popover is 12px with 4px padding, so its items are 8px (`md`). With 8px padding the items are 4px (`sm`). When padding is equal to or larger than the outer radius, the inner corner is square or `sm`.
3. Pill shapes (`rounded-full`) are only for elements exactly one line tall. Anything that can wrap or holds several lines gets a real number.
4. A surface that touches a screen edge has no corner on that edge. A bottom sheet rounds only its top corners (`rounded-t-xl`), a left sheet only its right corners (`rounded-r-xl`), a right sheet only its left corners (`rounded-l-xl`), a top sheet only its bottom corners (`rounded-b-xl`).
5. Rings and outlines: Tailwind `ring-*` and `outline-*` utilities already follow the element's radius, so nothing to change. For a separate wrapper element drawn around a rounded box, outer radius = inner radius + gap.
6. Rounded containers clip media. A card that holds a full-bleed image or header band needs `overflow-hidden`. An image inset by padding gets radius = outer minus padding.

## Element to token

| Element | Token |
| --- | --- |
| Chip, badge-like tag, small icon tile, menu-item highlight in a tight menu, checkbox | `sm` (4px) |
| Button, input, select trigger, textarea, toggle-group item, tooltip | `md` (8px) |
| Menu or select item inside a `p-1` menu | `md` (8px) |
| Card, panel, callout, popover, dropdown and select content, table wrapper, skeleton block | `lg` (12px) |
| Dialog, alert dialog, sheet, modal, large hero surface | `xl` (16px) |
| Avatar, switch, status dot, progress bar, single-line pill badge | `full` |

## Shadcn primitives (`src/components/ui`)

- Button, Input, Textarea, Select trigger, SearchableSelect trigger, FacetSelect: `rounded-md`.
- Select, DropdownMenu and Popover content: `rounded-lg`. Their items use `rounded-md` because the content padding is 4px.
- Card, Surface, Callout, Skeleton: `rounded-lg`.
- Dialog and AlertDialog content: `rounded-xl` (from `sm` up; full-screen on phones).
- Sheet: `rounded-xl` on the inner corners only, per side (see rule 4).
- Dialog and Sheet close buttons: `rounded-sm`.
- Badge: `rounded-full`, because it is a single line.
- ScrollArea viewport inherits its parent's radius through an inline `borderRadius: inherit`.

Changing `sm` and `md` also changes every other `rounded-sm` and `rounded-md` in the app. Review those uses against the table above when touching a screen.
