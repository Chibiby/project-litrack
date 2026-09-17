import { describe, it, expect } from "vitest";
import { assistantHiddenKey, parseAssistantHidden } from "@/hooks/use-assistant-hidden";

describe("assistantHiddenKey", () => {
  it("scopes the storage key to the given user id", () => {
    expect(assistantHiddenKey("user-1")).toBe("litrack:assistant-hidden:user-1");
    expect(assistantHiddenKey("user-2")).toBe("litrack:assistant-hidden:user-2");
  });

  it("produces different keys for different accounts on the same device", () => {
    expect(assistantHiddenKey("user-1")).not.toBe(assistantHiddenKey("user-2"));
  });
});

describe("parseAssistantHidden", () => {
  it("reads the literal string \"true\" as hidden", () => {
    expect(parseAssistantHidden("true")).toBe(true);
  });

  it("reads null (never set) as visible", () => {
    expect(parseAssistantHidden(null)).toBe(false);
  });

  it("reads garbage values as visible rather than throwing", () => {
    expect(parseAssistantHidden("false")).toBe(false);
    expect(parseAssistantHidden("")).toBe(false);
    expect(parseAssistantHidden("1")).toBe(false);
    expect(parseAssistantHidden("TRUE")).toBe(false);
    expect(parseAssistantHidden("{not json")).toBe(false);
  });
});
