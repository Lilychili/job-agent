"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppEvents } from "@/lib/useAppEvents";

const LINKS = [
  { href: "/board", label: "Board" },
  { href: "/questions", label: "Questions" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

// Every page has its own AppNav, so this keeps the count from blinking on navigation.
let lastWaiting = 0;

export function AppNav() {
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(lastWaiting);

  const refresh = useCallback(async () => {
    const res = await api<unknown[]>("/api/blockers");
    if (!res.ok) return;
    lastWaiting = res.data.length;
    setWaiting(lastWaiting);
  }, []);

  useEffect(() => {
    const load = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(load);
  }, [refresh]);

  useAppEvents({
    onEvent: (type) => {
      if (type === "application" || type === "reconnected") void refresh();
    },
  });

  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {l.label}
            {l.href === "/questions" && waiting > 0 && (
              <span className="nav-count" aria-label={`${waiting} waiting`}>
                {waiting}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
