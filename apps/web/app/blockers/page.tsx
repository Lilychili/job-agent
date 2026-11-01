import { PageShell } from "@/components/PageShell";
import { loadOpenBlockers } from "@/lib/data";
import { BlockersInbox } from "./BlockersInbox";

export const dynamic = "force-dynamic";

export default async function BlockersPage() {
  return (
    <PageShell
      title="Blockers"
      lead="Questions an agent couldn't answer from your Profile or Answers. Answer once; the run resumes and the answer is saved for next time."
    >
      <BlockersInbox initial={await loadOpenBlockers()} />
    </PageShell>
  );
}
