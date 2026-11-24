"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openChatSocket } from "@/lib/actions/chat";
import { callAction } from "@/lib/ui/call-action";
import type { RoomEvent } from "@/lib/chat/live/room-logic";

/**
 * The live half of a chat thread: one WebSocket to the channel's room.
 *
 * Purely additive. The thread keeps its own polling whatever happens here —
 * slowed to a safety net while `live` is true — so a missing room (local dev),
 * a dropped connection or a blocked WebSocket only means messages arrive on
 * the next poll. Typing and live presence exist only while connected.
 */

/** Waits before the 1st, 2nd and 3rd reconnect. After 3 failures in a row, stop. */
export const LIVE_BACKOFF_MS = [1_000, 3_000, 10_000] as const;
const MAX_FAILURES = LIVE_BACKOFF_MS.length;

/** At most one "typing" frame per this many ms. */
export const TYPING_THROTTLE_MS = 3_000;

/** Close code the room uses to ask for re-authorization (fresh ticket). */
const REAUTHORIZE_CODE = 4001;

export type ChatPublishedEvent = Extract<RoomEvent, { at: string }>;

export type ChatLive = {
  live: boolean;
  typingUserIds: string[];
  typingNames: string[];
  onlineUserIds: string[];
  sendTyping(on: boolean): void;
};

function socketUrl(path: string, ticket: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}?ticket=${encodeURIComponent(ticket)}`;
}

export function useChatLive(
  channelId: string | null,
  onChange: (event: ChatPublishedEvent) => void
): ChatLive {
  const [live, setLive] = useState(false);
  const [typing, setTyping] = useState<{ userIds: string[]; names: string[] }>({ userIds: [], names: [] });
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const onChangeRef = useRef(onChange);
  const lastTypingRef = useRef<{ on: boolean; at: number }>({ on: false, at: 0 });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!channelId || typeof WebSocket === "undefined") return;
    let stopped = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function reset() {
      setLive(false);
      setTyping({ userIds: [], names: [] });
      setOnlineUserIds([]);
    }

    function fail() {
      reset();
      failures += 1;
      if (stopped || failures >= MAX_FAILURES) return;
      retry = setTimeout(() => void connect(), LIVE_BACKOFF_MS[failures - 1]);
    }

    async function connect() {
      if (stopped || !channelId) return;
      const res = await callAction(() => openChatSocket({ channelId }));
      if (stopped) return;
      if (!res.ok || !res.data) return fail();
      // No room on this deployment: polling only, and nothing to retry.
      if (!res.data.live) return reset();

      const ws = new WebSocket(socketUrl(res.data.url, res.data.ticket));
      socketRef.current = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        failures = 0;
        setLive(true);
      };
      ws.onmessage = (message: MessageEvent) => {
        let frame: unknown;
        try {
          frame = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const event = frame as { type?: string } & Partial<RoomEvent>;
        if (event.type === "typing") {
          const t = event as Extract<RoomEvent, { type: "typing" }>;
          setTyping({ userIds: t.userIds ?? [], names: t.names ?? [] });
        } else if (event.type === "presence") {
          setOnlineUserIds((event as Extract<RoomEvent, { type: "presence" }>).userIds ?? []);
        } else if (
          event.type === "message.created" ||
          event.type === "message.updated" ||
          event.type === "reaction.changed" ||
          event.type === "read.changed"
        ) {
          onChangeRef.current(event as ChatPublishedEvent);
        }
      };
      ws.onerror = () => {
        // onclose follows and decides.
      };
      ws.onclose = (close: CloseEvent) => {
        if (socketRef.current === ws) socketRef.current = null;
        if (stopped) return;
        if (opened && close.code === REAUTHORIZE_CODE) {
          reset();
          void connect();
          return;
        }
        fail();
      };
    }

    void connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
      reset();
    };
  }, [channelId]);

  const sendTyping = useCallback((on: boolean) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== 1) return;
    const now = Date.now();
    const last = lastTypingRef.current;
    if (on && last.on && now - last.at < TYPING_THROTTLE_MS) return;
    if (!on && !last.on) return;
    lastTypingRef.current = { on, at: now };
    ws.send(JSON.stringify({ type: "typing", on }));
  }, []);

  return { live, typingUserIds: typing.userIds, typingNames: typing.names, onlineUserIds, sendTyping };
}
