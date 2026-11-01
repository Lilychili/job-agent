import { ensureAnswerDefaults } from "@jobagent/core";
import { PageShell } from "@/components/PageShell";
import { loadAnswers, loadOpenBlockers } from "@/lib/data";
import { getPool } from "@/lib/server";
import { AnswersEditor } from "./AnswersEditor";
import { BlockersInbox } from "./BlockersInbox";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  await ensureAnswerDefaults(getPool());
  const [blockers, answers] = await Promise.all([loadOpenBlockers(), loadAnswers()]);
  return (
    <PageShell title="Questions" lead="What application forms ask. Answer once and it's reused on every job. Anything left empty is asked here when a form first needs it.">
      <h2 className="section-title">Needs your answer</h2>
      <BlockersInbox initial={blockers} />
      <h2 className="section-title">Saved answers</h2>
      <AnswersEditor initial={answers} />
    </PageShell>
  );
}
