// One-off: re-encode public/aral-na-logo.png at a sane resolution.
// Source is 3522x1080; the component declares 704x216 and caps at
// sizes="(max-width: 640px) 78vw, 460px", so 1408px wide covers 2x DPR
// with room to spare. Writes candidates to /tmp-logo for comparison —
// does NOT overwrite the original.
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";

const SRC = "public/aral-na-logo.png";
const OUT = "tmp-logo";
const TARGET_W = 1408;

await mkdir(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
const orig = await stat(SRC);
console.log(
  `source: ${meta.width}x${meta.height} ${meta.channels}ch  ${orig.size} bytes`
);

const base = sharp(SRC).resize({ width: TARGET_W, withoutEnlargement: true });

const candidates = [
  ["resized-max.png", base.clone().png({ compressionLevel: 9, effort: 10 })],
  [
    "resized-palette.png",
    base.clone().png({ compressionLevel: 9, effort: 10, palette: true, colors: 256 }),
  ],
  [
    "resized-palette-128.png",
    base.clone().png({ compressionLevel: 9, effort: 10, palette: true, colors: 128 }),
  ],
  ["resized.webp", base.clone().webp({ quality: 90, effort: 6 })],
];

for (const [name, pipeline] of candidates) {
  const info = await pipeline.toFile(`${OUT}/${name}`);
  const pct = (((orig.size - info.size) / orig.size) * 100).toFixed(1);
  console.log(
    `${name.padEnd(24)} ${String(info.size).padStart(8)} bytes  -${pct}%  ${info.width}x${info.height}`
  );
}
