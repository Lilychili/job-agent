import Link from "next/link";
import { AppNav } from "./AppNav";

/** The header on every page but the landing hero. Keep it free of per-page content, so the menu never moves. */
export function TopBar() {
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Job Agent home">
        <span className="brand-mark" aria-hidden>◆</span>
        <span className="brand-name">Job Agent</span>
      </Link>
      <AppNav />
    </header>
  );
}
