"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BlockerAnswerForm } from "@/components/BlockerAnswerForm";
import { api } from "@/lib/api";
import { useAppEvents } from "@/lib/useAppEvents";

interface Item {
  id: string;
  question: string;
  label: string;
  company: string;
  title: string;
}

export function BlockersInbox({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const refetch = useCallback(async () => {
    const res = await api<Item[]>("/api/blockers");
    if (res.ok) setItems(res.data);
  }, []);

  // A raised or answered Blocker anywhere refreshes the inbox.
  useAppEvents({
    onEvent: (type) => {
      if (type === "application" || type === "reconnected") void refetch();
    },
  });

  if (items.length === 0) {
    return (
      <div className="panel empty-state">
        <h2>Nothing is waiting on you</h2>
        <p>When an agent hits a question it can&apos;t answer, it pauses and the question appears here and as a red badge on the card.</p>
        <Link className="btn" href="/board">
          Back to the board
        </Link>
      </div>
    );
  }
  return (
    <>
      {items.map((b) => (
        <BlockerAnswerForm key={b.id} blockerId={b.id} question={b.question} className="panel blocker-card" onAnswered={refetch}>
          <p className="meta">
            {b.company} · {b.title}
          </p>
          {b.label !== b.question && <p className="hint">Field: {b.label}</p>}
        </BlockerAnswerForm>
      ))}
    </>
  );
}
