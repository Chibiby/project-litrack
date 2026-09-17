APACHE SPARK — BRAND ASSETS
Software · Systems · Networks · Infrastructure

COLOURS
  Ink        #14181C   primary type, mark outline
  Paper      #F2EFE8   primary background
  Accent     #9E5430   inner figure, rules — one accent only
  Accent lt  #C97A4A   accent on dark backgrounds
  Soft       #7C7568   secondary type, annotation

TYPE
  Archivo         400 / 700   wordmark and headings (fonts.google.com/specimen/archivo)
  IBM Plex Mono   400 / 500   labels and descriptors, 0.2em tracking

FOLDERS
  svg/    vector, infinitely scalable — web and print
  png/    transparent raster, 2x–3x
  webp/   optimised raster for web (max 1600px wide, q92)

FILES
  apache-spark-lockup-horizontal-ink     primary logo, light backgrounds
  apache-spark-lockup-horizontal-paper   primary logo, dark backgrounds
  apache-spark-lockup-stacked-ink        stacked lockup with descriptor line
  apache-spark-wordmark-ink              wordmark only
  apache-spark-mark / -mark-accent       mark only (also -mark-paper.svg)
  apache-spark-app-icon, favicon-512/192/32.png, apache-spark-favicon.svg

NOTE ON THE SVG WORDMARK
  The SVG lockups reference the Archivo font family rather than outlined
  glyphs, so install Archivo (or load it from Google Fonts) wherever the SVG
  is rendered. Where the font cannot be guaranteed — email, third-party
  platforms, print handoff — use the PNG or WebP, which are pixel-exact.
  The mark-only SVGs are pure geometry and need no font.

CLEAR SPACE & MINIMUM SIZE
  Keep clear space equal to the height of the mark's inner diamond on all
  sides. Minimum widths: horizontal lockup 180px, stacked lockup 140px,
  mark alone 24px.

DON'T
  Recolour the mark outside the palette · stretch or rotate the lockup ·
  add shadows, glows or gradients · place the ink lockup on a dark field
  (use the paper version) · re-type the wordmark in another face.

FAVICON SNIPPET
  <link rel="icon" href="/apache-spark-favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/favicon-192.png">

WEB PRELOADER  (web/)
  spark-preloader.js   drop-in intro, no dependencies
  example-site.html    a working page with it installed

  Install — last thing before </body>:
    <script src="spark-preloader.js" data-once="session"></script>

  data-once="session"  play once per browser tab (recommended)
  data-auto="off"      don't autoplay; call SparkPreloader.play() yourself
  SparkPreloader.done  promise that resolves when the page is revealed

  TIMING — it yields to the page rather than running a fixed length.
  It draws the full sequence, then holds on the finished lockup for at least
  1.1s so the brand actually reads, and reveals once window.load has fired.
  On a slow connection it keeps holding the logo until the page is ready
  (up to 4s), then prints and reveals regardless. A click or any keypress skips straight to
  the reveal, so an impatient or returning visitor is never held.

  Responsive by construction: the guides span the viewport and the lockup
  scales in vmin, so it fits desktop, tablet and phone with no letterboxing.
  Locks scroll while playing, restores it on reveal, re-measures on resize,
  and honours prefers-reduced-motion.
