/**
 * Apache Spark mark — pure geometry, inlined.
 *
 * The shipped asset (`public/brand/apache-spark/apache-spark-mark.svg`) is the
 * same four lines and four vertex squares, but it carries a ~8 KB C2PA
 * manifest and would cost a request wherever it appears at 12px. The mark-only
 * SVGs need no font, so inlining is lossless. Brand palette: ink #14181C
 * outline, accent #9E5430 inner diamond — never recoloured outside those.
 */
export type ApacheSparkMarkProps = {
  className?: string;
  /** Outline + vertex colour. Defaults to the brand ink. */
  ink?: string;
  /** Inner diamond colour. Defaults to the brand accent. */
  accent?: string;
};

export function ApacheSparkMark({
  className,
  ink = "#14181C",
  accent = "#9E5430",
}: ApacheSparkMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
    >
      <path
        d="M128,32 L224,128 L128,224 L32,128 Z"
        fill="none"
        stroke={ink}
        strokeWidth={12}
      />
      <path
        d="M128,84 L172,128 L128,172 L84,128 Z"
        fill="none"
        stroke={accent}
        strokeWidth={12}
      />
      <g fill={ink}>
        <rect x="119" y="23" width="18" height="18" />
        <rect x="215" y="119" width="18" height="18" />
        <rect x="119" y="215" width="18" height="18" />
        <rect x="23" y="119" width="18" height="18" />
      </g>
    </svg>
  );
}

export default ApacheSparkMark;
