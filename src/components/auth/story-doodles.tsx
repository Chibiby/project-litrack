/**
 * Small authored SVG motifs for the storybook sign-in world. Purely
 * decorative — every motif is `aria-hidden` and unfocusable, so they never
 * enter the tab order or the accessibility tree.
 */
import { cn } from "@/lib/utils";

type DoodleProps = { className?: string };

/** A gold sun with a navy round-cap outline and eight short rays. */
export function SunDoodle({ className }: DoodleProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <circle cx="20" cy="20" r="9" fill="#FED110" stroke="#12294D" strokeWidth="2.5" />
      <g stroke="#12294D" strokeWidth="2.5" strokeLinecap="round">
        <line x1="20" y1="2" x2="20" y2="7" />
        <line x1="20" y1="33" x2="20" y2="38" />
        <line x1="2" y1="20" x2="7" y2="20" />
        <line x1="33" y1="20" x2="38" y2="20" />
        <line x1="7.5" y1="7.5" x2="11" y2="11" />
        <line x1="29" y1="29" x2="32.5" y2="32.5" />
        <line x1="7.5" y1="32.5" x2="11" y2="29" />
        <line x1="29" y1="11" x2="32.5" y2="7.5" />
      </g>
    </svg>
  );
}

/** A hand-drawn red wavy underline. Stretches to fill its box. */
export function Squiggle({ className }: DoodleProps) {
  return (
    <svg
      viewBox="0 0 200 20"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <path
        d="M2 14C22 4 38 4 58 14C78 24 94 24 114 14C134 4 150 4 170 14C182 19 190 17 198 12"
        fill="none"
        stroke="#E90423"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
