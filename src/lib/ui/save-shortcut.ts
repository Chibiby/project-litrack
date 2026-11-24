/**
 * Ctrl+S / ⌘+S saves the form you are working in (`src/components/save-shortcut.tsx`).
 *
 * Which button it presses, in order:
 * 1. An open pop-up limits the search to that pop-up.
 * 2. The form holding the focused field: its save button.
 * 3. Otherwise the one enabled, visible save button in that area. With none,
 *    or more than one, nothing is pressed: guessing which of two saves to run
 *    would be worse than doing nothing.
 *
 * Only save buttons count (`data-save`, which `Button` sets on every button
 * whose loading text is "Saving…"), so Ctrl+S never submits a search box,
 * a sign-in form or a delete.
 */

const DIALOG = '[role="dialog"], [role="alertdialog"]';
const SAVE = "button[data-save]";

/** Whether a key press is the save shortcut (Ctrl or ⌘ with S, nothing else). */
export function isSaveShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return typeof e.key === "string" && e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

function usable(el: Element, isShown: (el: Element) => boolean): el is HTMLButtonElement {
  return (
    el instanceof HTMLButtonElement &&
    !el.disabled &&
    el.getAttribute("aria-disabled") !== "true" &&
    isShown(el)
  );
}

function defaultIsShown(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** The save button Ctrl+S should press, or null when there is no clear one. */
export function findSaveButton(
  doc: Document,
  active: Element | null,
  isShown: (el: Element) => boolean = defaultIsShown
): HTMLButtonElement | null {
  const dialogs = [...doc.querySelectorAll(DIALOG)].filter(isShown);
  const scope: ParentNode = dialogs.at(-1) ?? doc;

  const form = active?.closest("form");
  if (form && (scope === doc || (scope as Element).contains(form))) {
    const inForm = [...form.querySelectorAll(SAVE)].filter((b) => usable(b, isShown));
    if (inForm.length === 1) return inForm[0] as HTMLButtonElement;
  }

  const saves = [...scope.querySelectorAll(SAVE)].filter((b) => usable(b, isShown));
  return saves.length === 1 ? (saves[0] as HTMLButtonElement) : null;
}
