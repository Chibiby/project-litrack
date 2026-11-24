"use client";

import { useEffect } from "react";
import { findSaveButton, isSaveShortcut } from "@/lib/ui/save-shortcut";

/**
 * Ctrl+S (⌘+S on a Mac) presses the save button of the form you are working
 * in, so a long form or grid saves without reaching for the mouse. On a page
 * with a save button that cannot be pressed yet (nothing changed, or a save
 * is running) the key does nothing, rather than opening the browser's "Save
 * page" dialog. A page with no save button keeps the browser's behaviour.
 * See `src/lib/ui/save-shortcut.ts` for how the button is found.
 */
export function SaveShortcut() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || !isSaveShortcut(event)) return;
      const button = findSaveButton(document, document.activeElement);
      if (!button && !document.querySelector("button[data-save]")) return;
      event.preventDefault();
      button?.click();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
