import { eq } from "drizzle-orm";
import { answerRule, checkAnswer, MAX_QUESTION_CHARS, questionKey, ValidationError } from "@jobagent/core";
import { answerBank, answerKind } from "@jobagent/db";
import { loadAnswers } from "@/lib/data";
import { readBody, route } from "@/lib/route";
import { getDb } from "@/lib/server";

type Kind = (typeof answerKind.enumValues)[number];

/** PUT { answers: [{ id, answer }] } saves the listed answers, all or none. Empty means "not answered yet". */
export const PUT = route(async (req) => {
  const b = await readBody<{ answers: unknown }>(req);
  if (!Array.isArray(b.answers)) throw new ValidationError("Invalid request.");
  const rows = await loadAnswers();
  const edits = (b.answers as unknown[]).map((item) => {
    const { id, answer } = (item ?? {}) as { id?: unknown; answer?: unknown };
    const row = rows.find((r) => r.id === id);
    if (!row || typeof answer !== "string") throw new ValidationError("That answer no longer exists. Reload the page.");
    const problem = checkAnswer(row.rule, answer);
    if (problem) throw new ValidationError(`${row.question} ${problem}`);
    return { id: row.id, answer: answer.trim() };
  });
  await getDb().transaction(async (tx) => {
    for (const { id, answer } of edits) await tx.update(answerBank).set({ answer }).where(eq(answerBank.id, id));
  });
  return Response.json({ ok: true });
});

/** POST { question, answer, kind } adds your own question. */
export const POST = route(async (req) => {
  const b = await readBody<{ question: unknown; answer: unknown; kind: unknown }>(req);
  const question = typeof b.question === "string" ? b.question.trim() : "";
  const answer = typeof b.answer === "string" ? b.answer.trim() : "";
  const kind = (b.kind ?? "text") as Kind;
  if (!question) throw new ValidationError("Write the question.");
  if (question.length > MAX_QUESTION_CHARS) throw new ValidationError(`Keep the question under ${MAX_QUESTION_CHARS} characters.`);
  if (!answerKind.enumValues.includes(kind)) throw new ValidationError("Unknown answer type.");
  const key = questionKey(question);
  const problem = checkAnswer(answerRule(key, kind), answer);
  if (problem) throw new ValidationError(problem);
  const [row] = await getDb()
    .insert(answerBank)
    .values({ questionKey: key, questionVariants: [question], answer, kind, reusable: true })
    .onConflictDoNothing()
    .returning({ id: answerBank.id });
  if (!row) throw new ValidationError("That question is already in your AnswerBank.");
  return Response.json({ id: row.id }, { status: 201 });
});

/** DELETE ?id= removes a question you added. The built-in ones stay; clear their answer instead. */
export const DELETE = route(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new ValidationError("Missing id.");
  const row = (await loadAnswers()).find((a) => a.id === id);
  if (!row) return Response.json({ error: "Answer not found." }, { status: 404 });
  if (row.isDefault) throw new ValidationError("Built-in questions can't be deleted.");
  await getDb().delete(answerBank).where(eq(answerBank.id, id));
  return Response.json({ ok: true });
});
