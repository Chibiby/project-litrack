/* Apache Spark — drop-in site preloader.
   Responsive by construction: guides span the viewport, the lockup scales in vmin.
   Usage:  <script src="spark-preloader.js" data-once="session"></script>
   API:    SparkPreloader.play()   replay on demand
           SparkPreloader.done     promise resolved when the page is revealed */
(function () {
  var INK = "#14181C", PAPER = "#F2EFE8", ACCENT = "#9E5430", SOFT = "#7C7568";
  var SANS = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  var MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
  var TAGS = ["SOFTWARE", "SYSTEMS", "NETWORKS", "INFRASTRUCTURE"];
  var TOTAL = 3.0, LOCATE = 0.0, DRAFT = 0.62, SET = 1.42, PRINT = 2.5, MIN_HOLD = 1.1, HOLD_CAP = 4.0;

  var eOutQuart = function (t) { return 1 - Math.pow(1 - t, 4); };
  var eOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var eInOutQuart = function (t) { return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2; };
  var eOutBack = function (t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  function seg(t, start, dur, ease) {
    var u = (t - start) / dur;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return (ease || eOutQuart)(u);
  }

  var EDGES = [[0, -96, 96, 0], [96, 0, 0, 96], [0, 96, -96, 0], [-96, 0, 0, -96]];
  var VERTS = [[0, -96], [96, 0], [0, 96], [-96, 0]];

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.setAttribute("style", style);
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function build() {
    var root = el("div", "position:fixed;inset:0;z-index:2147483000;overflow:hidden;" +
      "background:" + PAPER + ";pointer-events:auto;");
    root.setAttribute("data-spark-preloader", "");

    /* construction guides — viewport-wide, so they read on any aspect */
    var gh = el("div", "position:absolute;left:0;top:50%;width:100%;height:1px;" +
      "background:rgba(20,24,28,.3);transform:scaleX(0);transform-origin:0 50%;opacity:1;");
    var gv = el("div", "position:absolute;left:50%;top:0;width:1px;height:100%;" +
      "background:rgba(20,24,28,.3);transform:scaleY(0);transform-origin:50% 0;opacity:1;");
    var grid = el("div", "position:absolute;inset:0;opacity:0;background-image:" +
      "repeating-linear-gradient(0deg,rgba(20,24,28,.05) 0 1px,transparent 1px 72px)," +
      "repeating-linear-gradient(90deg,rgba(20,24,28,.05) 0 1px,transparent 1px 72px);");

    var ticks = el("div", "position:absolute;left:0;top:50%;width:100%;height:0;");
    var tickEls = [];
    for (var i = 0; i < 15; i++) {
      var major = i % 2 === 0;
      var t = el("div", "position:absolute;top:" + (major ? -16 : -9) + "px;width:1px;height:" +
        (major ? 16 : 9) + "px;background:rgba(20,24,28,.34);opacity:0;");
      t.dataset.frac = String(i / 14);
      ticks.appendChild(t);
      tickEls.push(t);
    }

    var cross = el("div", "position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;");
    cross.appendChild(el("div", "position:absolute;left:-14px;top:0;width:28px;height:1px;background:" + ACCENT + ";"));
    cross.appendChild(el("div", "position:absolute;left:0;top:-14px;width:1px;height:28px;background:" + ACCENT + ";"));

    /* the drafted mark — starts at viewport centre, rises into the lockup */
    var markWrap = el("div", "position:absolute;left:50%;top:50%;width:0;height:0;");
    var svg = svgEl("svg", {
      viewBox: "-120 -120 240 240", "aria-hidden": "true",
      style: "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);overflow:visible;" +
        "width:clamp(110px,22vmin,264px);height:clamp(110px,22vmin,264px);",
    });
    var edgeEls = EDGES.map(function (e) {
      var l = svgEl("line", {
        x1: e[0], y1: e[1], x2: e[2], y2: e[3], pathLength: "1",
        stroke: INK, "stroke-width": "7", "stroke-linecap": "square",
        "stroke-dasharray": "1 1", "stroke-dashoffset": "1",
      });
      svg.appendChild(l); return l;
    });
    var innerEls = EDGES.map(function (e) {
      var l = svgEl("line", {
        x1: e[0] * 0.46, y1: e[1] * 0.46, x2: e[2] * 0.46, y2: e[3] * 0.46, pathLength: "1",
        stroke: ACCENT, "stroke-width": "7", "stroke-linecap": "square",
        "stroke-dasharray": "1 1", "stroke-dashoffset": "1",
      });
      svg.appendChild(l); return l;
    });
    var vertEls = VERTS.map(function (v) {
      var r = svgEl("rect", { x: v[0] - 5, y: v[1] - 5, width: 10, height: 10, fill: INK, opacity: "0" });
      svg.appendChild(r); return r;
    });
    markWrap.appendChild(svg);

    /* lockup column — mark slot above the wordmark */
    var col = el("div", "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "display:flex;flex-direction:column;align-items:center;gap:clamp(14px,3vmin,30px);" +
      "width:min(92vw,1100px);");
    var slot = el("div", "flex:0 0 auto;width:clamp(110px,22vmin,264px);height:clamp(110px,22vmin,264px);");
    var wordRow = el("div", "display:flex;justify-content:center;white-space:nowrap;line-height:1.02;" +
      "font-family:" + SANS + ";font-size:clamp(30px,8.4vmin,92px);letter-spacing:-0.01em;");
    var w1 = el("span", "display:inline-block;font-weight:400;color:" + SOFT +
      ";clip-path:inset(0 100% 0 0);", "APACHE\u00A0");
    var w2 = el("span", "display:inline-block;font-weight:700;color:" + INK +
      ";clip-path:inset(0 100% 0 0);", "SPARK");
    wordRow.appendChild(w1); wordRow.appendChild(w2);
    var rule = el("div", "width:min(78vw,560px);height:2px;background:" + ACCENT +
      ";transform:scaleX(0);");
    var tagRow = el("div", "display:flex;flex-wrap:wrap;justify-content:center;align-items:center;" +
      "gap:clamp(7px,1.6vmin,16px);font-family:" + MONO +
      ";font-size:clamp(9px,1.55vmin,15px);letter-spacing:0.2em;color:" + SOFT + ";");
    var tagEls = [];
    TAGS.forEach(function (tag, i) {
      if (i > 0) {
        var d = el("div", "width:5px;height:1px;background:" + ACCENT + ";opacity:0;");
        tagRow.appendChild(d); tagEls.push(d);
      }
      var s = el("span", "opacity:0;", tag);
      tagRow.appendChild(s); tagEls.push(s);
    });
    col.appendChild(slot); col.appendChild(wordRow); col.appendChild(rule); col.appendChild(tagRow);

    var sheetNote = el("div", "position:absolute;left:clamp(18px,4vw,76px);top:clamp(18px,4vh,74px);" +
      "font-family:" + MONO + ";font-size:clamp(9px,1.3vmin,14px);letter-spacing:0.14em;color:" +
      SOFT + ";opacity:0;", "SHEET 01 — IDENTITY");
    var scaleNote = el("div", "position:absolute;right:clamp(18px,4vw,76px);top:clamp(18px,4vh,74px);" +
      "font-family:" + MONO + ";font-size:clamp(9px,1.3vmin,14px);letter-spacing:0.14em;color:" +
      SOFT + ";opacity:0;", "SCALE 1:1");

    /* everything above lifts away as one drawing */
    var draft = el("div", "position:absolute;inset:0;");
    [grid, gh, gv, ticks, cross, markWrap, col, sheetNote, scaleNote].forEach(function (n) {
      draft.appendChild(n);
    });

    var sweep = el("div", "position:absolute;top:0;bottom:0;left:0;width:3px;background:" +
      ACCENT + ";opacity:0;");

    root.appendChild(draft);
    root.appendChild(sweep);

    return {
      root: root, draft: draft, grid: grid, gh: gh, gv: gv, tickEls: tickEls, cross: cross,
      markWrap: markWrap, edgeEls: edgeEls, innerEls: innerEls, vertEls: vertEls,
      slot: slot, w1: w1, w2: w2, rule: rule, tagEls: tagEls,
      sheetNote: sheetNote, scaleNote: scaleNote, sweep: sweep,
    };
  }

  function play(opts) {
    opts = opts || {};
    var existing = document.querySelector("[data-spark-preloader]");
    if (existing) existing.remove();

    var P = build();
    (document.body || document.documentElement).appendChild(P.root);

    var prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    var markTarget = 0, vw = 0, vh = 0;
    function measure() {
      vw = window.innerWidth; vh = window.innerHeight;
      var s = P.slot.getBoundingClientRect();
      markTarget = (s.top + s.height / 2) - vh / 2;
      P.tickEls.forEach(function (t) {
        t.style.left = Math.round(+t.dataset.frac * vw) + "px";
      });
    }
    measure();
    window.addEventListener("resize", measure);

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var resolve, done = new Promise(function (r) { resolve = r; });
    /* wall clock + hard guard: a throttled or backgrounded tab must never be
       left under the overlay waiting for animation frames that don't come */
    var t0 = (window.performance && performance.now ? performance.now() : Date.now());
    var guard = setTimeout(finish, (TOTAL + HOLD_CAP) * 1000 + 1500);

    function finish() {
      if (!P.root.isConnected) return;
      clearTimeout(guard);
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", skip);
      document.documentElement.style.overflow = prevOverflow;
      P.root.remove();
      if (typeof opts.onDone === "function") opts.onDone();
      resolve();
    }

    if (reduce) {
      /* honour reduced motion: hold the finished lockup briefly, then reveal */
      frame(PRINT);
      setTimeout(finish, 900);
      return done;
    }

    function frame(t) {
      var guideH = seg(t, LOCATE, 0.46, eInOutQuart);
      var guideV = seg(t, LOCATE + 0.1, 0.46, eInOutQuart);
      var travel = seg(t, SET - 0.1, 0.5, eInOutQuart);
      var lift = seg(t, PRINT + 0.02, 0.32, eInOutQuart);
      /* the drawing aids are temporary: they clear once the lockup is legible */
      var scaffold = 1 - seg(t, SET + 0.12, 0.44, eInOutQuart);
      var sweepP = seg(t, PRINT, 0.34, eInOutQuart);

      P.gh.style.transform = "scaleX(" + guideH + ")";
      P.gv.style.transform = "scaleY(" + guideV + ")";
      P.gh.style.opacity = String(scaffold);
      P.gv.style.opacity = String(scaffold);
      P.grid.style.opacity = String(guideH * 0.7 * scaffold);
      P.tickEls.forEach(function (n) {
        var x = +n.dataset.frac * vw;
        var p = (guideH * vw - x) / 70;
        n.style.opacity = String(Math.max(0, Math.min(1, p)) * scaffold);
      });
      P.cross.style.opacity = String(seg(t, LOCATE + 0.32, 0.26, eOutBack) * scaffold);

      P.edgeEls.forEach(function (n, i) {
        n.setAttribute("stroke-dashoffset", String(1 - seg(t, DRAFT + i * 0.11, 0.3, eInOutQuart)));
      });
      P.innerEls.forEach(function (n, i) {
        n.setAttribute("stroke-dashoffset", String(1 - seg(t, DRAFT + 0.38 + i * 0.075, 0.26, eInOutQuart)));
      });
      P.vertEls.forEach(function (n, i) {
        n.setAttribute("opacity", String(seg(t, DRAFT + 0.48 + i * 0.055, 0.22, eOutCubic)));
      });

      P.markWrap.style.transform = "translate(0," + (travel * markTarget) + "px) scale(" +
        (1 - travel * 0.12) + ")";

      P.w1.style.clipPath = "inset(0 " + ((1 - seg(t, SET + 0.1, 0.34, eInOutQuart)) * 100) + "% 0 0)";
      P.w2.style.clipPath = "inset(0 " + ((1 - seg(t, SET + 0.26, 0.32, eInOutQuart)) * 100) + "% 0 0)";
      P.rule.style.transform = "scaleX(" + seg(t, SET + 0.46, 0.3, eInOutQuart) + ")";
      P.tagEls.forEach(function (n, i) {
        n.style.opacity = String(seg(t, SET + 0.52 + i * 0.032, 0.26, eOutBack));
      });
      P.sheetNote.style.opacity = String(seg(t, 0.04, 0.3, eOutBack) * 0.8 * scaffold);
      P.scaleNote.style.opacity = String(seg(t, 0.16, 0.3, eOutBack) * 0.8 * scaffold);

      P.draft.style.opacity = String(1 - lift);
      P.draft.style.transform = "translateY(" + (lift * -34) + "px)";
      P.sweep.style.opacity = sweepP > 0 && sweepP < 1 ? "1" : "0";
      P.sweep.style.transform = "translateX(" + (sweepP * vw) + "px)";
      P.root.style.opacity = String(1 - seg(t, PRINT + 0.16, 0.34, eInOutQuart));
    }

    /* The sequence always runs 0 → PRINT, so the lockup is fully drawn and
       readable before anything lifts. At PRINT it HOLDS on that finished frame
       until the page has loaded (or HOLD_CAP passes), then prints and reveals.
       A click or keypress ends the hold early; it can never truncate the draw. */
    var pageReady = (document.readyState === "complete");
    var holdMs = 0, heldBefore = 0, holdStart = null;
    if (!pageReady) {
      window.addEventListener("load", function () { pageReady = true; });
    }
    function skip() {
      if (holdStart !== null) { pageReady = true; heldBefore = MIN_HOLD * 1000; }
    }
    P.root.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);

    function tick() {
      var now = (window.performance && performance.now ? performance.now() : Date.now());
      /* holdMs is frozen time: it grows only while we're waiting at PRINT,
         so the clock resumes exactly where it paused once the page is ready */
      var t = (now - t0 - holdMs) / 1000;

      if (t >= PRINT && (!pageReady || heldBefore + (holdStart === null ? 0 : now - holdStart) < MIN_HOLD * 1000)) {
        if (holdStart === null) holdStart = now;
        if (now - holdStart >= HOLD_CAP * 1000) pageReady = true;
        else {
          holdMs = heldBefore + (now - holdStart);
          frame(PRINT);
          requestAnimationFrame(tick);
          return;
        }
      }
      if (holdStart !== null) {
        holdMs = heldBefore + (now - holdStart);
        heldBefore = holdMs;
        holdStart = null;
      }

      frame(Math.min(t, TOTAL));
      if (t < TOTAL) requestAnimationFrame(tick);
      else finish();
    }
    frame(0);
    requestAnimationFrame(tick);
    return done;
  }

  var api = { play: play, done: null };
  window.SparkPreloader = api;

  /* auto-play on load unless data-auto="off"; data-once="session" shows it once per tab */
  var tag = document.currentScript;
  var auto = !tag || tag.getAttribute("data-auto") !== "off";
  var once = tag && tag.getAttribute("data-once") === "session";
  function start() {
    if (once) {
      try {
        if (sessionStorage.getItem("spark-preloader-seen") === "1") return;
        sessionStorage.setItem("spark-preloader-seen", "1");
      } catch (e) {}
    }
    api.done = play();
  }
  if (auto) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }

  /* demo hook: lets a host page replay inside an iframe */
  window.addEventListener("message", function (e) {
    if (e && e.data === "spark:replay") api.done = play();
  });
})();
