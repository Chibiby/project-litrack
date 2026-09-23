/**
 * The shapes and copy of the header/footer every export carries.
 *
 * Pure and client-safe on purpose: the printable learners report renders in a
 * client component, and importing these from `sheet-header.ts` (server-only,
 * Prisma) would break the client build. `sheet-header.ts` re-exports them.
 */

/** A DepEd-style "Label: Value" header line (School ID, School Year, ...). */
export type ReportHeaderField = { label: string; value: string };

/**
 * The shared footer every generated Excel sheet and PDF ends with — a system
 * generates this report, so there is no signature to collect, only the two
 * names for the record and a line saying so plainly.
 */
export type ReportFooter = {
  /** The signed-in actor's display name — same value the header's "Prepared by" carries. */
  preparedBy: string;
  /** The school's School Head, earliest-created if a school somehow has more than one. Blank, never a placeholder string, when the school has none on file. */
  notedBy: string;
};

/**
 * The footer logos for HTML, left to right, served from `public/brand/report/`.
 * Same images and order as `REPORT_FOOTER_LOGOS` (`logo-data.ts`), which embeds
 * them as base64 for the Excel/PDF renderers.
 */
export const REPORT_FOOTER_LOGO_SOURCES: readonly { src: string; alt: string }[] = [
  { src: "/brand/report/deped-seal.png", alt: "DepEd seal" },
  { src: "/brand/report/bagong-pilipinas.png", alt: "Bagong Pilipinas" },
  { src: "/brand/report/deped-wordmark.png", alt: "DepEd" },
  { src: "/brand/report/division-sarangani.png", alt: "DepEd Division of Sarangani" },
];

export const SYSTEM_GENERATED_NOTE =
  "This is a system-generated report from LITRACK. No signature is required.";
