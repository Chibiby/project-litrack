import type { Config } from "tailwindcss";

const config: Config = {
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
        /* Storybook display lettering on the sign-in screens (Baloo 2). */
        story: ["var(--font-story)", "ui-sans-serif", "system-ui", "sans-serif"],
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
        /* ARAL accent. DEFAULT/soft are theme-aware; numbered steps stay
           static so existing violet-200 / violet-950 utilities keep working. */
        /* ARAL Program logo inks, sampled from public/logo.png. The sign-in
           screens print in these (always light); the app keeps its tokens. */
        aral: {
          blue: "#013E88",
          navy: "#12294D",
          gold: "#FED110",
          sun: "#FFBA04",
          red: "#E90423",
          slate: "#4C6971",
          line: "#B8C6DA",
          /* Field and switch edges: 3.4:1 on white, the WCAG 1.4.11 floor for input boundaries. */
          edge: "#7B8CA6",
          wash: "#EEF3FB",
          paper: "#FFFFFF",
          /* Storybook tints: pale sky and pale sunshine, plus a mid sky for accents. */
          sky: "#E3F0FD",
          cloud: "#C7E0FA",
          sunlight: "#FFF4C2",
        },
        violet: {
          DEFAULT: "hsl(var(--violet))",
          foreground: "hsl(var(--violet-foreground))",
          soft: "hsl(var(--violet-soft))",
          "soft-foreground": "hsl(var(--violet-soft-foreground))",
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
      },
      keyframes: {
        /* The sign-in card turning to its next step, from an already-visible start. */
        "story-pop": {
          "0%": { opacity: "0.6", transform: "translateY(6px) scale(0.985)" },
          "100%": { opacity: "1", transform: "none" },
        },
        /* A gentle nudge on the Continue button's arrow icon, on hover. */
        "story-nudge": {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(3px)" },
        },
      },
      animation: {
        "story-pop": "story-pop 260ms ease-out",
        "story-nudge": "story-nudge 600ms ease-in-out",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.04)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
