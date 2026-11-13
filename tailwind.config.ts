import type { Config } from "tailwindcss";
import twColors from "tailwindcss/colors";

/**
 * A colour by meaning: the full Tailwind scale of its family (so every
 * numbered step keeps its exact value), plus `strong`, a theme-aware text
 * colour (700 in light, 200 in dark) whose dark value comes from globals.css
 * instead of a `dark:` class on each element. See docs/design-system.md.
 */
const meaning = (name: string, scale: Record<string, string>) => ({
  ...scale,
  strong: `rgb(var(--${name}-strong) / <alpha-value>)`,
});

const config: Config = {
  // `hover:` and `group-hover:` apply only on a device that can hover
  // (a mouse or trackpad). On a phone or tablet a tap would otherwise leave
  // the hover style stuck on until the next tap elsewhere.
  future: { hoverOnlyWhenSupported: true },
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // Layout tokens (e.g. sidebar width/pl) may live outside components/app.
    "./src/hooks/**/*.{js,ts,jsx,tsx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      textColor: {
        destructive: {
          DEFAULT: "hsl(var(--destructive-text))",
          foreground: "hsl(var(--destructive-foreground))",
        },
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        surface: "hsl(var(--surface))",
        "surface-header": "hsl(var(--surface-header))",
        // Glassmorphism tint: plain white, only ever used at low opacity
        // (bg-glass/25 and the like) with a dark: override, for the frosted
        // header, search and sidebar highlight.
        glass: "rgb(255 255 255 / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        /* Colours by meaning. Raw family names (violet, amber, emerald, rose,
           sky) are not used in components: lint warns on them.
           aral    = the ARAL accent (was violet). DEFAULT/soft are theme-aware;
                     the numbered steps are the old violet steps, unchanged.
           warning = amber, success = emerald, danger = rose, info = sky. */
        aral: {
          ...twColors.violet,
          DEFAULT: "hsl(var(--aral) / <alpha-value>)",
          foreground: "hsl(var(--aral-foreground) / <alpha-value>)",
          soft: "hsl(var(--aral-soft) / <alpha-value>)",
          "soft-foreground": "hsl(var(--aral-soft-foreground) / <alpha-value>)",
          strong: "hsl(var(--aral-strong) / <alpha-value>)",
          50: "hsl(255 100% 97%)",
          100: "hsl(255 96% 94%)",
          200: "hsl(255 92% 89%)",
          500: "hsl(255 75% 60%)",
          600: "hsl(255 68% 53%)",
          700: "hsl(255 62% 45%)",
          800: "hsl(255 58% 37%)",
          900: "hsl(255 54% 28%)",
          950: "hsl(255 50% 18%)",
        },
        warning: meaning("warning", twColors.amber),
        success: meaning("success", twColors.emerald),
        danger: meaning("danger", twColors.rose),
        info: meaning("info", twColors.sky),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
        xl: "calc(var(--radius) + 4px)",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.04)",
        /* Named shadows. Each reads a CSS variable that globals.css sets
           for light and dark, so no element needs a dark: shadow. */
        glass: "var(--shadow-glass)",
        raised: "var(--shadow-raised)",
        lift: "var(--shadow-lift)",
        float: "var(--shadow-float)",
        control: "var(--shadow-control)",
        indicator: "var(--shadow-indicator)",
        highlight: "inset 0 1px 0 rgb(255 255 255 / 0.8)",
        "highlight-soft": "inset 0 1px 0 rgb(255 255 255 / 0.6)",
        pressed: "0 2px 6px -2px rgb(15 23 42 / 0.15)",
        field: "0 1px 2px rgb(15 23 42 / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.6)",
        "glass-lit": "var(--shadow-glass), inset 0 1px 0 rgb(255 255 255 / 0.5)",
        /* The sign-in card and its fields: a deep violet cast, light only. */
        auth: "0 24px 60px -20px rgb(46 16 101 / 0.35)",
        "auth-raised": "0 24px 60px -20px rgb(46 16 101 / 0.35), 0 2px 6px rgb(46 16 101 / 0.08)",
        "auth-field": "inset 0 1px 0 rgb(255 255 255 / 0.8), 0 1px 2px rgb(46 16 101 / 0.06)",
        "rule-b": "inset 0 -1px 0 hsl(var(--border))",
        "rule-r": "inset -1px 0 0 hsl(var(--border))",
      },
      /* Motion: three durations and three curves (globals.css, Motion). */
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        slide: "var(--ease-slide)",
        bounce: "var(--ease-bounce)",
      },
      fontSize: {
        "2xs": "11px",
        caption: "13px",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/container-queries")],
};

export default config;
