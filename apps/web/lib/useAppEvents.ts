"use client";

import { useEffect, useRef } from "react";

/** Subscribes to the live feed (/api/events). The handlers can change between renders without reconnecting. */
export function useAppEvents(handlers: { onEvent: (type: string) => void; onStatus?: (status: "live" | "offline") => void }) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => latest.current.onStatus?.("live");
    es.onerror = () => latest.current.onStatus?.("offline");
    es.onmessage = (e) => latest.current.onEvent((JSON.parse(e.data) as { type: string }).type);
    return () => es.close();
  }, []);
}
