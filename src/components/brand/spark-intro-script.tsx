import {
  SPARK_INTRO_COVER_ATTR,
  SPARK_INTRO_COVER_TIMEOUT_MS,
  SPARK_INTRO_FLAG,
  SPARK_INTRO_PATHS,
  SPARK_INTRO_WINDOW_KEY,
  SPARK_PAPER,
} from "@/lib/brand/spark-intro";

/**
 * Blocking inline script that claims the Apache Spark intro before first paint.
 *
 * Same shape and the same reason as `ThemeScript`: the decision depends on
 * sessionStorage, which the server cannot read, so deferring it to hydration
 * would flash the login page for a beat before a full-screen brand animation
 * dropped over it — which reads as a glitch, not an intro. This runs during
 * head parse, paints the paper-coloured cover itself, and leaves
 * `SparkIntro` to load the animation and take over underneath it.
 *
 * Must stay synchronous and in <head> order: no `defer`, no `async`, and not
 * below body content. `document.body` does not exist yet at this point, hence
 * the cover is appended to `documentElement`.
 *
 * The intro is claimed exactly once per tab, and only on the entry routes
 * (`SPARK_INTRO_PATHS`) — the app's own routes open with `PostLoginSplash`.
 */
export function SparkIntroScript() {
  const js = `(function(){try{
var paths=${JSON.stringify(SPARK_INTRO_PATHS)};
var p=location.pathname.replace(/\\/+$/,"")||"/";
if(paths.indexOf(p)<0)return;
if(sessionStorage.getItem(${JSON.stringify(SPARK_INTRO_FLAG)})==="1")return;
sessionStorage.setItem(${JSON.stringify(SPARK_INTRO_FLAG)},"1");
window[${JSON.stringify(SPARK_INTRO_WINDOW_KEY)}]="pending";
var c=document.createElement("div");
c.setAttribute(${JSON.stringify(SPARK_INTRO_COVER_ATTR)},"");
c.setAttribute("aria-hidden","true");
c.setAttribute("style","position:fixed;inset:0;z-index:2147482999;background:${SPARK_PAPER};");
document.documentElement.appendChild(c);
setTimeout(function(){if(c.parentNode)c.parentNode.removeChild(c);},${SPARK_INTRO_COVER_TIMEOUT_MS});
}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export default SparkIntroScript;
