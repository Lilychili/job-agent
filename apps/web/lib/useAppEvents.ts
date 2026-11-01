"use client";

import { useEffect, useRef } from "react";

type Handlers = { onEvent: (type: string) => void; onStatus?: (status: "live" | "offline") => void };

// Browsers allow six connections to this server, and every live feed holds one for as long as it is
// open. So a tab keeps a single feed however many components listen, and only while it is visible.
// Coming back counts as "live": listeners refetch what they missed.
const listeners = new Set<{ current: Handlers }>();
let feed: EventSource | null = null;

function sync() {
  const wanted = listeners.size > 0 && document.visibilityState === "visible";
  if (wanted === !!feed) return;
  if (!wanted) {
    feed!.close();
    feed = null;
    return;
  }
  feed = new EventSource("/api/events");
  feed.onopen = () => listeners.forEach((l) => l.current.onStatus?.("live"));
  feed.onerror = () => listeners.forEach((l) => l.current.onStatus?.("offline"));
  feed.onmessage = (e) => {
    const { type } = JSON.parse(e.data) as { type: string };
    listeners.forEach((l) => l.current.onEvent(type));
  };
}

/** Subscribes to the live feed (/api/events). The handlers can change between renders without reconnecting. */
export function useAppEvents(handlers: Handlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (listeners.size === 0) document.addEventListener("visibilitychange", sync);
    listeners.add(latest);
    sync();
    return () => {
      listeners.delete(latest);
      if (listeners.size === 0) document.removeEventListener("visibilitychange", sync);
      sync();
    };
  }, []);
}
