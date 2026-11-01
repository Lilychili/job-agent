import Link from "next/link";

const TABS = [
  { id: "about", href: "/profile", label: "About me" },
  { id: "looking-for", href: "/profile/looking-for", label: "What I'm looking for" },
] as const;

export function ProfileTabs({ active }: { active: (typeof TABS)[number]["id"] }) {
  return (
    <nav className="tabs" aria-label="Profile">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} className={t.id === active ? "active" : ""} aria-current={t.id === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
