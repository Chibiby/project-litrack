"use client";

import dynamic from "next/dynamic";

/**
 * Lazy-load export UI; Excel generation stays in the server action.
 * SSR enabled so the grade filter renders immediately (no skeleton placeholder).
 */
export const ExportControls = dynamic(() =>
  import("@/components/reports/export-controls").then((m) => m.ExportControls)
);
