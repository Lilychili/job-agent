import { TopBar } from "./TopBar";

/** Header + centered content column shared by every page except the board and the landing hero. */
export function PageShell({ title, tabs, lead, children }: { title: string; tabs?: React.ReactNode; lead?: string; children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <TopBar />
      <main className="page">
        <h1 className="page-title">{title}</h1>
        {tabs}
        {lead && <p className="page-lead">{lead}</p>}
        {children}
      </main>
    </div>
  );
}
