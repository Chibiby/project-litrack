import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LITRACK — Learner Profiling & Literacy Tracking",
  description:
    "School learner profiling and literacy tracking for DepEd reading programs",
};

/**
 * Direction contract for the teacher dashboard (`/teacher`), seed db875848.
 * Emitted into the built markup so the shipped page can be audited against the
 * decision that produced it. The same contract heads
 * `src/components/dashboard/teacher/dashboard-body.tsx`.
 */
const DIRECTION_CONTRACT = [
  "THESIS: the teacher dashboard is a triage board that names learners, refusing the counter wall of metric cards that reports inventory instead of priority.",
  "OWN-WORLD: LITRACK's committed identity — blue-gray field, white Surface panels, blue primary, amber secondary, violet reserved for ARAL; status colour confined to discs, chips and cells, never a tinted card; Inter with tabular numerals on every figure.",
  "STORY: a teacher sees who is stuck, what is unmarked, and who moved a band, then clicks straight into the entry screen that fixes it.",
  "FIRST VIEWPORT: one dated scope line stating the week, grades and roster in words; then three lanes — Needs you now (violet, named learners with reasons), Open this week (unmarked work with counts), Moving up (band movement). The primary action is the lane row itself.",
  "FORM: Triage Lanes, index 3 of 7 grounded structures; seed db875848.",
  "FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance",
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="impeccable-direction" content={DIRECTION_CONTRACT} />
        <ThemeScript />
      </head>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <ThemeProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to main content
          </a>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
