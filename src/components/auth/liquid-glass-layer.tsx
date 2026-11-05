"use client";

import * as React from "react";
import { buildLiquidGlassMap } from "@/lib/ui/liquid-glass-map";
import styles from "./liquid-glass.module.css";

/**
 * How far the rim bends the art, per colour channel, in CSS pixels
 * (feDisplacementMap moves up to scale / 2). Red bends a little more than
 * blue, so the rim splits light into a faint rainbow fringe, as real glass does.
 */
const REFRACTION_SCALE = { r: 110, g: 100, b: 90 } as const;
/** Width of the bending band along the card's edge, in CSS pixels. */
const BEZEL = 44;
/** Barely any frost under the lens: clear glass, the art stays sharp. */
const FROST = 1.5;

/**
 * Marks the sign-in screen's background art (LoginShell) for the lens to copy.
 * LoginShell is a server component, so it spells the attribute out itself.
 */
const LOGIN_ART_ATTR = "data-login-art";

/**
 * The lens filter runs in Chromium only. Safari and Firefox keep the
 * frosted-blur fallback that the module's CSS already gives this layer.
 */
function supportsLens(): boolean {
  if (typeof navigator === "undefined") return false;
  const brands = (
    navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
  ).userAgentData?.brands;
  return Boolean(brands?.some((b) => b.brand === "Chromium"));
}

type Lens = { width: number; height: number; map: string };

/**
 * The Liquid Glass body of the sign-in card: rendered as the card's first child,
 * behind its content. It tints the card, draws the light-catching rim, and on
 * Chromium bends the art along the edge.
 *
 * Why the lens filters a copy of the art rather than the backdrop: a
 * `backdrop-filter: url(#svg)` is re-run by the compositor on every frame that
 * anything on screen moves (a caret, a button press, a spinner), and this
 * filter is heavy enough to halve the frame rate. A plain `filter` on painted
 * content is rasterised once and reused until that content changes, so the
 * layer holds a copy of LoginShell's background art, lined up with the real
 * one, and only redraws when the card moves or resizes.
 */
export function LiquidGlassLayer() {
  const ref = React.useRef<HTMLDivElement>(null);
  const paneRef = React.useRef<HTMLDivElement>(null);
  const filterId = `liquid-glass-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [lens, setLens] = React.useState<Lens | null>(null);

  // Build the displacement map for the card's size (rebuilt when it resizes).
  React.useEffect(() => {
    const el = ref.current;
    // Reduce Transparency still gets the lens (the operator's call: Windows
    // ships with Transparency effects off on many school PCs); the module's CSS
    // raises the tint under that setting instead, so text stays readable.
    if (!el || !supportsLens() || !document.querySelector(`[${LOGIN_ART_ATTR}]`)) return;

    let frame = 0;
    const build = () => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      if (width < 2 || height < 2) return;
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const pixels = buildLiquidGlassMap({ width, height, radius, bezel: BEZEL });
      ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
      const map = canvas.toDataURL("image/png");
      setLens((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height, map },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(build);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Copy the background art into the pane and keep it lined up with the real
  // art as the card moves (page scroll on phones, layout changes, resizes).
  const hasLens = lens !== null;
  React.useEffect(() => {
    const el = ref.current;
    const pane = paneRef.current;
    const art = document.querySelector<HTMLElement>(`[${LOGIN_ART_ATTR}]`);
    if (!hasLens || !el || !pane || !art) return;

    const copy = art.cloneNode(true) as HTMLElement;
    copy.removeAttribute(LOGIN_ART_ATTR);
    copy.removeAttribute("class");
    copy.className = styles.art;
    pane.replaceChildren(copy);

    let frame = 0;
    let last = "";
    const place = () => {
      const card = el.getBoundingClientRect();
      const real = art.getBoundingClientRect();
      const next = `${real.left - card.left},${real.top - card.top},${real.width},${real.height}`;
      // Unchanged geometry must not touch styles: any write re-runs the filter.
      if (next === last) return;
      last = next;
      copy.style.left = `${real.left - card.left}px`;
      copy.style.top = `${real.top - card.top}px`;
      copy.style.width = `${real.width}px`;
      copy.style.height = `${real.height}px`;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };

    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    observer.observe(art);
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      pane.replaceChildren();
    };
  }, [hasLens]);

  return (
    <div ref={ref} aria-hidden className={styles.layer} data-lens={lens ? "refract" : "frost"}>
      {lens ? (
        <>
          <div ref={paneRef} className={styles.pane} style={{ filter: `url(#${filterId})` }} />
          <svg width="0" height="0" className={styles.defs} focusable="false">
            <filter
              id={filterId}
              filterUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={lens.width}
              height={lens.height}
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur in="SourceGraphic" stdDeviation={FROST} result="frost" />
              <feImage
                href={lens.map}
                x="0"
                y="0"
                width={lens.width}
                height={lens.height}
                preserveAspectRatio="none"
                result="map"
              />
              {/* One bend per colour channel, then recombined: chromatic fringe. */}
              <feDisplacementMap in="frost" in2="map" scale={REFRACTION_SCALE.r} xChannelSelector="R" yChannelSelector="G" result="bentR" />
              <feColorMatrix in="bentR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="onlyR" />
              <feDisplacementMap in="frost" in2="map" scale={REFRACTION_SCALE.g} xChannelSelector="R" yChannelSelector="G" result="bentG" />
              <feColorMatrix in="bentG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="onlyG" />
              <feDisplacementMap in="frost" in2="map" scale={REFRACTION_SCALE.b} xChannelSelector="R" yChannelSelector="G" result="bentB" />
              <feColorMatrix in="bentB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="onlyB" />
              <feBlend in="onlyR" in2="onlyG" mode="screen" result="rg" />
              <feBlend in="rg" in2="onlyB" mode="screen" result="lens" />
              <feColorMatrix in="lens" type="saturate" values="1.4" />
            </filter>
          </svg>
        </>
      ) : null}
    </div>
  );
}
