// "Export all" and "delete all" from docs/SECURITY.md §5. All personal data lives in Postgres
// and DATA_DIR, so this is the whole of it. The encrypted API key is never exported.
import { rm } from "node:fs/promises";
import { agentRun, answerBank, application, blocker, discoveredCompany, document, evidence, job, preferences, profile, rejectedPosting, type Db } from "@jobagent/db";
import { resolveDataPath, type CoreContext } from "./context";

const DATA_FOLDERS = ["cv", "documents", "evidence"];

/** Everything stored about the owner, as plain JSON. Files on disk are listed by path, not embedded. */
export async function exportAll(db: Db) {
  const [profiles, prefs, answers, jobs, applications, documents, evidenceRows, blockers, runs, discovered, rejected] = await Promise.all([
    db.select().from(profile),
    db.select().from(preferences),
    db.select().from(answerBank),
    db.select().from(job),
    db.select().from(application),
    db.select().from(document),
    db.select().from(evidence),
    db.select().from(blocker),
    db.select().from(agentRun),
    db.select().from(discoveredCompany),
    db.select().from(rejectedPosting),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: profiles[0] ?? null,
    preferences: prefs[0] ?? null,
    answers,
    jobs,
    applications,
    documents,
    evidence: evidenceRows,
    blockers,
    agentRuns: runs,
    discoveredCompanies: discovered,
    rejectedPostings: rejected,
  };
}

/** Erase all personal data, the stored API key and every uploaded or generated file. */
export async function deleteAll(ctx: CoreContext): Promise<void> {
  await ctx.pool.query(
    `truncate application_event, evidence, blocker, document, agent_run, application, job, answer_bank, profile, preferences, discovered_company, rejected_posting`,
  );
  await ctx.pool.query(`update settings set encrypted_api_key = null, api_key_last4 = null, default_model = null, encrypted_gmail_token = null`);
  for (const folder of DATA_FOLDERS) {
    await rm(resolveDataPath(ctx, folder), { recursive: true, force: true });
  }
}
