import { ensureAnswerDefaults } from "@jobagent/core";
import { PageShell } from "@/components/PageShell";
import { loadAnswers } from "@/lib/data";
import { getPool } from "@/lib/server";
import { AnswersEditor } from "./AnswersEditor";

export const dynamic = "force-dynamic";

export default async function AnswersPage() {
  await ensureAnswerDefaults(getPool());
  return (
    <PageShell
      title="Answers"
      lead="Questions application forms keep asking. Answer them once and the Shipper reuses them. Anything left empty becomes a Blocker you answer when it first comes up."
    >
      <AnswersEditor initial={await loadAnswers()} />
    </PageShell>
  );
}
