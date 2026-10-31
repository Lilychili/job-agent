// M0 STUB — replaced by the real Scout (ATS APIs + Claude structured output) in M2.
// It already does what the real one must do after the LLM: normalize, dedupe, insert, notify.
import { canonicalUrl, normalizeCompany, normalizeTitle } from "@jobagent/core";
import { application, applicationEvent, job, notify, withTx } from "@jobagent/db";
import { sleep, type RunHelpers, type Outcome } from "../runner";

const FAKE_POSTINGS = [
  {
    ats: "greenhouse" as const,
    sourceUrl: "https://boards.greenhouse.io/democo/jobs/4001?gh_src=demo",
    company: "DemoCo Inc.",
    title: "Senior Frontend Engineer",
    location: "Barcelona",
    remote: "hybrid" as const,
    salary: "not stated",
    matchScore: 82,
    matchReasons: { met: ["TypeScript", "React", "Barcelona"], missed: ["GraphQL"] },
  },
  {
    ats: "lever" as const,
    sourceUrl: "https://jobs.lever.co/samplelabs/7f3a2b?lever-source=board",
    company: "Sample Labs",
    title: "Full-stack Engineer (Node.js)",
    location: "Remote EU",
    remote: "remote" as const,
    salary: "€60,000 – €75,000",
    matchScore: 74,
    matchReasons: { met: ["TypeScript", "Remote EU"], missed: ["Go"] },
  },
  {
    ats: "ashby" as const,
    sourceUrl: "https://jobs.ashbyhq.com/placeholder/9c1d",
    company: "Placeholder GmbH",
    title: "Frontend Developer",
    location: "Berlin",
    remote: "onsite" as const,
    salary: "not stated",
    matchScore: 55,
    matchReasons: { met: ["React"], missed: ["Onsite in Berlin"] },
  },
];

export async function scoutSearch({ ctx, log, signal }: RunHelpers): Promise<Outcome> {
  await log("Querying boards (stub)");
  await sleep(1500, signal);

  let inserted = 0;
  await withTx(ctx.pool, async (tx) => {
    for (const p of FAKE_POSTINGS) {
      const [row] = await tx
        .insert(job)
        .values({
          ...p,
          canonicalUrl: canonicalUrl(p.sourceUrl),
          companyNorm: normalizeCompany(p.company),
          titleNorm: normalizeTitle(p.title),
          rawPosting: `(stub posting for ${p.title} at ${p.company})`,
        })
        .onConflictDoNothing()
        .returning({ id: job.id });
      if (!row) continue; // duplicate: canonical URL or company+title already on the board
      const [app] = await tx.insert(application).values({ jobId: row.id }).returning({ id: application.id });
      await tx.insert(applicationEvent).values({
        applicationId: app!.id,
        action: "found",
        toStatus: "found",
        actorType: "agent",
      });
      inserted++;
    }
    if (inserted) await notify(tx, { type: "jobs_added", count: inserted });
  });

  const skipped = FAKE_POSTINGS.length - inserted;
  await log(`Inserted ${inserted}, skipped ${skipped} duplicates`);
  return { kind: "succeeded", output: { inserted, skipped } };
}
