"use client";

import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const refetch = useCallback(async () => {
    const res = await api<Item[]>("/api/blockers");
    if (res.ok) setItems(res.data);
  }, []);

  // An answer here also lands in Saved answers, further down the page.
  const onAnswered = useCallback(async () => {
    await refetch();
    router.refresh();
  }, [refetch, router]);

  // A raised or answered Blocker anywhere refreshes the inbox.
  useAppEvents({
    onEvent: (type) => {
      if (type === "application" || type === "reconnected") void refetch();
    },
  });

  if (items.length === 0) {
    return (
      <div className="panel empty-state">
        <h3>Nothing is waiting on you</h3>
        <p className="hint">When an agent hits a question it can&apos;t answer, it pauses and the question appears here and on the job&apos;s card.</p>
      </div>
    );
  }
  return (
    <>
      {items.map((b) => (
        <BlockerAnswerForm key={b.id} blockerId={b.id} question={b.question} className="panel blocker-card" onAnswered={onAnswered}>
          <p className="meta">
            {b.company} · {b.title}
          </p>
          {b.label !== b.question && <p className="hint">Field: {b.label}</p>}
        </BlockerAnswerForm>
      ))}
    </>
  );
}
