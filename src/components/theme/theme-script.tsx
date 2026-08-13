import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Blocking inline script that applies the stored theme before first paint.
 *
 * Without this, a dark-mode user sees a white flash on every hard navigation:
 * the server renders light (it cannot read localStorage) and React only
 * corrects it after hydration. Must stay synchronous and in <head> order —
 * do not add `defer` or `async`, and do not move it below <body> content.
 *
 * Deliberately does NOT consult prefers-color-scheme: light is the default
 * regardless of OS (spec R9).
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY
  )});if(t!=="dark"&&t!=="light")t=${JSON.stringify(
    DEFAULT_THEME
  )};if(t==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
