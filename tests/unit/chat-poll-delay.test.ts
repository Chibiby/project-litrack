import { describe, expect, it } from "vitest";
import { chatPollDelayMs } from "@/components/chat/chat-thread";

describe("chatPollDelayMs", () => {
  it("polls a live thread every 6 s", () => {
    expect(chatPollDelayMs(0)).toBe(6_000);
    expect(chatPollDelayMs(59_999)).toBe(6_000);
  });

  it("slows a quiet thread to 15 s, then 30 s", () => {
    expect(chatPollDelayMs(60_000)).toBe(15_000);
    expect(chatPollDelayMs(5 * 60_000 - 1)).toBe(15_000);
    expect(chatPollDelayMs(5 * 60_000)).toBe(30_000);
  });
});
