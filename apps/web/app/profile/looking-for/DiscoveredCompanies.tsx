"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

interface DiscoveredItem {
  id: string;
  name: string;
  reason: string;
  hasBoard: boolean;
}

/** What Claude found on the web. Dismissing a company stops Search reading it and keeps it from coming back. */
export function DiscoveredCompanies({ companies }: { companies: DiscoveredItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function dismiss(id: string) {
    const res = await api(`/api/discovered/${id}`, "DELETE");
    if (!res.ok) return setError(res.error);
    setError(null);
    router.refresh();
  }

  return (
    <section className="panel">
      <h2>Found by Claude</h2>
      <p className="hint">
        Companies Claude found by searching the web. Search reads the ones with a job board it can read, and adds new ones each time.
      </p>
      {companies.length === 0 && <p className="hint">Nothing yet. The first search will look.</p>}
      {companies.map((c) => (
        <div className="row" key={c.id}>
          <div className="field">
            <strong>{c.name}</strong>{" "}
            <span className="hint">{c.hasBoard ? c.reason : "no job board found, so it isn't searched"}</span>
          </div>
          <button type="button" className="btn ghost" onClick={() => dismiss(c.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
