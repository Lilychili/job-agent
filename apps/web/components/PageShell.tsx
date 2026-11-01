import Link from "next/link";
import { AppNav } from "./AppNav";

/** Header + centered content column shared by every page except the board and the landing hero. */
export function PageShell({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Job Agent home">
          <span className="brand-mark" aria-hidden>◆</span>
          <span className="brand-name">Job Agent</span>
        </Link>
        <AppNav />
      </header>
      <main className="page">
        <h1 className="page-title">{title}</h1>
        {lead && <p className="page-lead">{lead}</p>}
        {children}
      </main>
    </div>
  );
}
