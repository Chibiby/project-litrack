/* Apache Spark — direction B, "Blueprint": drafted, measured, printed. 2s, 1:1. */

const { CompositionStage, useComposition, Easing, animate } = window;
const { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakColor } = window;

const SQ = 1080, CX = 540, CY = 540;

const MOTION = {
  enter: (from, to, start, dur, ease) =>
    animate({ from, to, start, end: start + dur, ease: ease || Easing.easeOutQuart }),
  draw: (start, dur, ease) =>
    animate({ from: 0, to: 1, start, end: start + dur, ease: ease || Easing.easeInOutQuart }),
  pop: (start, dur) =>
    animate({ from: 0, to: 1, start, end: start + dur, ease: Easing.easeOutCubic }),
};

const PAPER = "#F2EFE8";
const INK = "#14181C";
const RULE = "rgba(20,24,28,.16)";
const SOFT = "#7C7568";

const SANS = "'Archivo', 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const D = 96; /* diamond half-diagonal */
const EDGES = [
  [0, -D, D, 0], [D, 0, 0, D], [0, D, -D, 0], [-D, 0, 0, -D],
];
const TAGS = ["SOFTWARE", "SYSTEMS", "NETWORKS", "INFRASTRUCTURE"];

function Piece({ accent, notes, reveal }) {
  const { T, CUES, authoredTotal } = useComposition();
  const colRef = React.useRef(null);
  const slotRef = React.useRef(null);
  const [markTarget, setMarkTarget] = React.useState(-108);

  React.useEffect(() => {
    const measure = () => {
      const col = colRef.current, slot = slotRef.current;
      if (!col || !slot) return;
      const y = col.offsetTop - col.offsetHeight / 2 + slot.offsetTop + slot.offsetHeight / 2;
      if (Number.isFinite(y) && y > 0) setMarkTarget(y - CY);
    };
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    const id = setTimeout(measure, 400);
    return () => clearTimeout(id);
  }, []);

  const C = { Draft: CUES.Draft, Set: CUES.Set, Print: CUES.Print };

  const guideH = MOTION.draw(0.0, 0.62)(T);
  const guideV = MOTION.draw(0.14, 0.62)(T);
  const cross = MOTION.pop(0.46, 0.34)(T);
  const travel = MOTION.draw(C.Set - 0.12, 0.7)(T);
  const markY = travel * markTarget;
  const markScale = 1 - travel * 0.12;
  const ruleP = MOTION.draw(C.Set + 0.62, 0.4)(T);
  const dims = MOTION.draw(C.Draft + 0.72, 0.5)(T);

  /* the print: the drafted ink lifts off the sheet, the paper becomes the page */
  const lift = reveal ? MOTION.draw(C.Print + 0.02, 0.36)(T) : 0;
  const sweep = MOTION.draw(C.Print, 0.4, Easing.easeInOutQuart)(T);
  /* the page clears again just before the loop seam, back to blank paper */
  const page = lift * (1 - MOTION.draw(authoredTotal - 0.16, 0.16)(T));
  /* the drawing aids are temporary: they clear once the lockup is legible */
  const scaffold = 1 - MOTION.draw(C.Set + 0.3, 0.6)(T);
  /* the sheet never sits still: a slow push across the whole take */
  const camScale = MOTION.enter(1.035, 1.0, 0, 3.5, Easing.easeOutSine)(T);

  const wipeWord = (text, weight, size, color, start, dur) => {
    const p = MOTION.draw(start, dur)(T);
    return (
      <span style={{
        display: "inline-block", fontFamily: SANS, fontWeight: weight, fontSize: size,
        letterSpacing: "-0.01em", color,
        clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`,
      }}>{text}</span>
    );
  };

  return (
    <div data-screen-label={`t=${T.toFixed(1)}s`} style={{
      position: "absolute", inset: 0, background: PAPER, overflow: "hidden",
    }}>
      {/* the page underneath, once the draft lifts */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 112, height: 1, background: RULE, opacity: page }} />
      <div style={{
        position: "absolute", left: 76, top: 62, fontFamily: MONO, fontSize: 15,
        letterSpacing: "0.22em", color: SOFT, opacity: page,
      }}>APACHE SPARK</div>
      <div style={{
        position: "absolute", right: 76, top: 62, display: "flex", gap: 30, opacity: page,
        fontFamily: MONO, fontSize: 13, letterSpacing: "0.2em", color: SOFT,
      }}>
        <span>PLATFORM</span><span>NETWORKS</span><span>CONTACT</span>
      </div>
      <div style={{
        position: "absolute", left: 76, right: 76, top: 190, height: 700, opacity: page,
        border: "1px solid rgba(20,24,28,.16)",
        background: "repeating-linear-gradient(45deg, rgba(20,24,28,.055) 0 1px, transparent 1px 9px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: MONO, fontSize: 14, letterSpacing: "0.26em", color: SOFT,
      }}>SITE CONTENT</div>
      <div style={{
        position: "absolute", right: 76, bottom: 64, display: "flex", alignItems: "center", gap: 10,
        fontFamily: MONO, fontSize: 13, letterSpacing: "0.18em", color: SOFT, opacity: page,
      }}>
        <span style={{ width: 6, height: 6, background: accent }} />
        <span>DRAWN &amp; BUILT BY APACHE SPARK</span>
      </div>

      {/* the draft itself */}
      <div style={{
        position: "absolute", inset: 0, opacity: 1 - lift,
        transform: `translateY(${lift * -34}px) scale(${camScale})`,
        transformOrigin: "50% 50%",
      }}>
        {/* construction guides */}
        <div style={{
          position: "absolute", left: 0, top: CY, width: `${guideH * 100}%`, height: 1,
          background: "rgba(20,24,28,.3)", opacity: scaffold,
        }} />
        <div style={{
          position: "absolute", left: CX, top: 0, width: 1, height: `${guideV * 100}%`,
          background: "rgba(20,24,28,.3)", opacity: scaffold,
        }} />
        {/* measurement ticks marching out behind the guide */}
        {Array.from({ length: 9 }, (_, i) => {
          const x = 76 + i * 116;
          const p = Math.max(0, Math.min(1, (guideH * SQ - x) / 70));
          const major = i % 2 === 0;
          return (
            <div key={i} style={{
              position: "absolute", left: x, top: CY - (major ? 16 : 9), width: 1,
              height: major ? 16 : 9, background: "rgba(20,24,28,.34)",
              opacity: p * scaffold,
            }} />
          );
        })}
        <div style={{
          position: "absolute", inset: 0, opacity: guideH * 0.7 * scaffold,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(20,24,28,.05) 0 1px, transparent 1px 72px)," +
            "repeating-linear-gradient(90deg, rgba(20,24,28,.05) 0 1px, transparent 1px 72px)",
        }} />

        <svg viewBox={`0 0 ${SQ} ${SQ}`} width={SQ} height={SQ}
          style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {/* dimension annotation across the mark */}
          <g opacity={dims * scaffold * 0.8} stroke={accent} strokeWidth="1" fill="none">
            <line x1={CX - D} y1={CY + 148} x2={CX + D} y2={CY + 148} pathLength="1"
              strokeDasharray="1 1" strokeDashoffset={1 - dims} />
            <line x1={CX - D} y1={CY + 140} x2={CX - D} y2={CY + 156} />
            <line x1={CX + D} y1={CY + 140} x2={CX + D} y2={CY + 156} />
          </g>
          <text x={CX} y={CY + 178} textAnchor="middle" fill={accent}
            fontFamily={MONO} fontSize="14" letterSpacing="2"
            opacity={dims * scaffold * 0.85}>192 UNITS</text>
        </svg>

        {/* crosshair at origin */}
        <div style={{ position: "absolute", left: CX, top: CY, width: 0, height: 0 }}>
          <div style={{
            position: "absolute", left: -14, top: -0.5, width: 28, height: 1,
            background: accent, opacity: cross * scaffold,
          }} />
          <div style={{
            position: "absolute", left: -0.5, top: -14, width: 1, height: 28,
            background: accent, opacity: cross * scaffold,
          }} />
        </div>

        {/* the mark: a drafted diamond, edge by edge */}
        <div style={{
          position: "absolute", left: CX, top: CY, width: 0, height: 0,
          transform: `translate(0, ${markY}px) scale(${markScale})`,
        }}>
          <svg viewBox="-140 -140 280 280" width="280" height="280"
            style={{ position: "absolute", left: -140, top: -140, overflow: "visible" }}>
            {EDGES.map((e, i) => {
              const p = MOTION.draw(C.Draft + i * 0.16, 0.44)(T);
              return (
                <line key={i} x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} pathLength="1"
                  stroke={INK} strokeWidth="3" strokeLinecap="square"
                  strokeDasharray="1 1" strokeDashoffset={1 - p} />
              );
            })}
            {EDGES.map((e, i) => {
              const p = MOTION.draw(C.Draft + 0.54 + i * 0.11, 0.36)(T);
              return (
                <line key={"i" + i} x1={e[0] * 0.46} y1={e[1] * 0.46}
                  x2={e[2] * 0.46} y2={e[3] * 0.46} pathLength="1"
                  stroke={accent} strokeWidth="3" strokeLinecap="square"
                  strokeDasharray="1 1" strokeDashoffset={1 - p} />
              );
            })}
            {[[0, -D], [D, 0], [0, D], [-D, 0]].map((v, i) => {
              const p = MOTION.pop(C.Draft + 0.68 + i * 0.08, 0.3)(T);
              return <rect key={"v" + i} x={v[0] - 4} y={v[1] - 4} width="8" height="8"
                fill={INK} opacity={p} />;
            })}
          </svg>
        </div>

        {/* lockup column */}
        <div ref={colRef} style={{
          position: "absolute", left: "50%", top: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 26,
        }}>
          <div ref={slotRef} style={{ width: 280, height: 240, flex: "0 0 auto" }} />
          <div style={{ whiteSpace: "nowrap", lineHeight: 1.02 }}>
            {wipeWord("APACHE\u00A0", 400, 74, SOFT, C.Set + 0.14, 0.46)}
            {wipeWord("SPARK", 700, 74, INK, C.Set + 0.36, 0.42)}
          </div>
          <div style={{
            width: 500, height: 2, marginTop: -4, background: accent,
            transform: `scaleX(${ruleP})`,
          }} />
          <div style={{
            display: "flex", gap: 16, alignItems: "center", marginTop: -6,
            fontFamily: MONO, fontSize: 15, letterSpacing: "0.2em", color: SOFT,
          }}>
            {TAGS.map((tag, i) => {
              const p = MOTION.pop(C.Set + 0.66 + i * 0.09, 0.34)(T);
              return (
                <React.Fragment key={tag}>
                  {i > 0 ? <span style={{ width: 5, height: 1, background: accent, opacity: p }} /> : null}
                  <span style={{ opacity: p }}>{tag}</span>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* margin notes */}
        {notes ? (
          <React.Fragment>
            <div style={{
              position: "absolute", left: 76, top: 74, fontFamily: MONO, fontSize: 14,
              letterSpacing: "0.14em", color: SOFT, opacity: MOTION.pop(0.06, 0.42)(T) * 0.8 * scaffold,
            }}>SHEET 01 — IDENTITY</div>
            <div style={{
              position: "absolute", right: 76, top: 74, fontFamily: MONO, fontSize: 14,
              letterSpacing: "0.14em", color: SOFT, opacity: MOTION.pop(0.22, 0.42)(T) * 0.8 * scaffold,
            }}>SCALE 1:1</div>
          </React.Fragment>
        ) : null}
      </div>

      {/* the printing sweep */}
      <div style={{
        position: "absolute", top: 0, bottom: 0, width: 3, background: accent,
        left: `${sweep * 100}%`, opacity: sweep > 0 && sweep < 1 ? 1 : 0,
      }} />
    </div>
  );
}

function SparkAssembly() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  return (
    <React.Fragment>
      <CompositionStage width={SQ} height={SQ} bg={PAPER}
        scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
        <Piece accent={t.accent} notes={t.marginNotes} reveal={t.revealSite} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Brand" />
        <TweakColor label="Accent" value={t.accent}
          options={["#9E5430", "#1F4E79", "#2E6151", "#7A2E3C"]}
          onChange={(v) => setTweak("accent", v)} />
        <TweakToggle label="Margin notes" value={t.marginNotes}
          onChange={(v) => setTweak("marginNotes", v)} />
        <TweakSection label="Playback" />
        <TweakToggle label="Lift to reveal page" value={t.revealSite}
          onChange={(v) => setTweak("revealSite", v)} />
        <TweakToggle label="Motion editor" value={t.motionEditor}
          onChange={(v) => setTweak("motionEditor", v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}

window.SparkAssembly = SparkAssembly;
