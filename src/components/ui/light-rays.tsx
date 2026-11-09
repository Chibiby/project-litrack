"use client";

import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Soft animated light rays shining down from the top of their container, with
 * two faint glows in the upper corners. Adapted from Magic UI's Light Rays
 * (magicui.design/docs/components/light-rays) without its `motion`
 * dependency: each ray is a CSS keyframe animation (`light-ray` in
 * globals.css) that fades in, sways a little and fades out.
 *
 * Purely decorative (aria-hidden, no pointer events). Ray positions come from
 * a fixed-seed generator rather than Math.random, so the server render and
 * hydration produce the same rays (no mismatch, no client-only effect). Under `prefers-reduced-motion` the rays hold still at a low opacity.
 */

interface LightRaysProps {
  className?: string;
  /** How many rays. */
  count?: number;
  /** Ray and glow colour. Keep it pale and translucent. */
  color?: string;
  /** Blur radius of each ray, in px. */
  blur?: number;
  /** Seconds for one ray's fade-in, sway and fade-out. */
  speed?: number;
  /** Ray length (any CSS length). */
  length?: string;
}

type Ray = {
  id: string;
  left: number;
  rotate: number;
  width: number;
  swing: number;
  delay: number;
  duration: number;
  intensity: number;
};

/** mulberry32: a tiny seeded PRNG, so every render yields the same rays. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRays(count: number, cycle: number): Ray[] {
  const random = seededRandom(0x11a7);
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const left = 8 + random() * 84;
    return {
      id: `${index}-${Math.round(left * 10)}`,
      left,
      rotate: -28 + random() * 56,
      width: 160 + random() * 160,
      swing: 0.8 + random() * 1.8,
      delay: random() * cycle,
      duration: cycle * (0.75 + random() * 0.5),
      intensity: 0.6 + random() * 0.5,
    };
  });
}

export function LightRays({
  className,
  count = 7,
  color = "rgba(160, 210, 255, 0.2)",
  blur = 36,
  speed = 14,
  length = "70vh",
}: LightRaysProps) {
  const cycle = Math.max(speed, 0.1);
  const rays = useMemo(() => createRays(count, cycle), [count, cycle]);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={
        {
          "--light-rays-color": color,
          "--light-rays-blur": `${blur}px`,
          "--light-rays-length": length,
        } as CSSProperties
      }
    >
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 20% 15%, color-mix(in srgb, var(--light-rays-color) 45%, transparent), transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 80% 10%, color-mix(in srgb, var(--light-rays-color) 35%, transparent), transparent 75%)",
        }}
      />
      {rays.map((ray) => (
        <div
          key={ray.id}
          className="light-ray absolute -top-[12%] origin-top -translate-x-1/2 rounded-full opacity-0 dark:mix-blend-screen"
          style={
            {
              left: `${ray.left}%`,
              width: `${ray.width}px`,
              height: "var(--light-rays-length)",
              background:
                "linear-gradient(to bottom, color-mix(in srgb, var(--light-rays-color) 70%, transparent), transparent)",
              filter: "blur(var(--light-rays-blur))",
              "--ray-rotate-from": `${ray.rotate - ray.swing}deg`,
              "--ray-rotate-to": `${ray.rotate + ray.swing}deg`,
              "--ray-intensity": ray.intensity,
              animationDuration: `${ray.duration * 1.1}s`,
              animationDelay: `${ray.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
