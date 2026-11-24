// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findSaveButton, isSaveShortcut } from "@/lib/ui/save-shortcut";

const shown = () => true;
const key = (over: Partial<KeyboardEvent>) =>
  ({ key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isSaveShortcut", () => {
  it("matches Ctrl+S and Cmd+S only", () => {
    expect(isSaveShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSaveShortcut(key({ metaKey: true, key: "S" }))).toBe(true);
    expect(isSaveShortcut(key({}))).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(key({ ctrlKey: true, key: "k" }))).toBe(false);
  });
});

describe("findSaveButton", () => {
  it("presses the save button of the form holding the focused field", () => {
    document.body.innerHTML = `
      <form id="a"><input id="ia"><button data-save id="sa">Save A</button></form>
      <form id="b"><input id="ib"><button data-save id="sb">Save B</button></form>`;
    const active = document.getElementById("ib");
    expect(findSaveButton(document, active, shown)?.id).toBe("sb");
  });

  it("uses the only save button on the page when focus is outside a form", () => {
    document.body.innerHTML = `<div><button data-save id="only">Save</button></div><button id="other">Delete</button>`;
    expect(findSaveButton(document, document.body, shown)?.id).toBe("only");
  });

  it("presses nothing when two save buttons compete", () => {
    document.body.innerHTML = `<button data-save>Save A</button><button data-save>Save B</button>`;
    expect(findSaveButton(document, document.body, shown)).toBeNull();
  });

  it("never presses a submit button that is not a save button", () => {
    document.body.innerHTML = `<form><input id="q"><button type="submit">Search</button></form>`;
    expect(findSaveButton(document, document.getElementById("q"), shown)).toBeNull();
  });

  it("skips disabled save buttons", () => {
    document.body.innerHTML = `<button data-save disabled>Save</button>`;
    expect(findSaveButton(document, document.body, shown)).toBeNull();
  });

  it("looks only inside an open pop-up", () => {
    document.body.innerHTML = `
      <button data-save id="page">Save page form</button>
      <div role="dialog"><button data-save id="dialog">Save</button></div>`;
    expect(findSaveButton(document, document.body, shown)?.id).toBe("dialog");
  });
});
