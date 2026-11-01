import { eq } from "drizzle-orm";
import { questionKey, ValidationError } from "@jobagent/core";
import { answerBank, answerKind } from "@jobagent/db";
import { loadAnswers } from "@/lib/data";
import { readBody, route } from "@/lib/route";
import { getDb } from "@/lib/server";

type Kind = (typeof answerKind.enumValues)[number];

/** PUT { id, answer } updates one answer. An empty answer means "not answered yet". */
export const PUT = route(async (req) => {
  const b = await readBody<{ id: unknown; answer: unknown }>(req);
  if (typeof b.id !== "string" || typeof b.answer !== "string") throw new ValidationError("Invalid request.");
  const [row] = await getDb()
    .update(answerBank)
    .set({ answer: b.answer.trim() })
    .where(eq(answerBank.id, b.id))
    .returning({ id: answerBank.id });
  if (!row) return Response.json({ error: "Answer not found." }, { status: 404 });
  return Response.json({ ok: true });
});

/** POST { question, answer, kind } adds your own question. */
export const POST = route(async (req) => {
  const b = await readBody<{ question: unknown; answer: unknown; kind: unknown }>(req);
  const question = typeof b.question === "string" ? b.question.trim() : "";
  const answer = typeof b.answer === "string" ? b.answer.trim() : "";
  const kind = (b.kind ?? "text") as Kind;
  if (!question) throw new ValidationError("Write the question.");
  if (!answerKind.enumValues.includes(kind)) throw new ValidationError("Unknown answer type.");
  const [row] = await getDb()
    .insert(answerBank)
    .values({ questionKey: questionKey(question), questionVariants: [question], answer, kind, reusable: true })
    .onConflictDoNothing()
    .returning({ id: answerBank.id });
  if (!row) throw new ValidationError("That question is already in your AnswerBank.");
  return Response.json({ id: row.id }, { status: 201 });
});

/** DELETE ?id= removes a question you added. The built-in ones can only be cleared. */
export const DELETE = route(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new ValidationError("Missing id.");
  const row = (await loadAnswers()).find((a) => a.id === id);
  if (!row) return Response.json({ error: "Answer not found." }, { status: 404 });
  if (row.isDefault) await getDb().update(answerBank).set({ answer: "" }).where(eq(answerBank.id, id));
  else await getDb().delete(answerBank).where(eq(answerBank.id, id));
  return Response.json({ ok: true });
});
