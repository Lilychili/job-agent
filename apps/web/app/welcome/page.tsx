import { ensureAnswerDefaults } from "@jobagent/core";
import { encryptionReady, loadAnswers, loadLatestExtraction, loadPreferences, loadProfile, loadSettingsView, loadWorkerLastSeen } from "@/lib/data";
import { getPool } from "@/lib/server";
import { Onboarding, type OnboardingProps } from "./Onboarding";
import { KEY_QUESTIONS } from "./questions";

export const dynamic = "force-dynamic";

/** The guided first run: connect Claude, read the CV, say what you want, answer the questions every form asks. */
export default async function WelcomePage() {
  await ensureAnswerDefaults(getPool());
  const [settings, profile, extraction, prefs, answers, workerLastSeenAt] = await Promise.all([
    loadSettingsView(),
    loadProfile(),
    loadLatestExtraction(),
    loadPreferences(),
    loadAnswers(),
    loadWorkerLastSeen(),
  ]);

  const props: OnboardingProps = {
    settings: { provider: settings.provider, hasKey: settings.hasKey, maskedKey: settings.maskedKey, ready: settings.ready },
    encryptionReady: encryptionReady(),
    profile: profile && {
      contact: profile.contact,
      facts: profile.facts,
      confirmed: profile.confirmed,
      sourceFilePath: profile.sourceFilePath,
    },
    extraction,
    prefs: prefs && {
      roles: prefs.roles,
      locations: prefs.locations,
      remote: prefs.remote,
      salaryFloor: prefs.salaryFloor?.toString() ?? "",
      salaryCurrency: prefs.salaryCurrency ?? "",
      stackMustHave: prefs.stackMustHave,
      stackNiceToHave: prefs.stackNiceToHave,
      exclusions: prefs.exclusions,
      companyBoards: prefs.companyBoards,
    },
    // The few questions with no sensible default that nearly every form asks; the rest are asked when a form needs them.
    questions: KEY_QUESTIONS.flatMap((q) => answers.filter((a) => a.question === q.question).map((a) => ({ ...a, ...q }))),
    // Links in the CV answer these two without asking.
    linkAnswers: answers.filter((a) => a.rule.format === "link").map((a) => ({ id: a.id, question: a.question, answer: a.answer })),
    workerLastSeenAt: workerLastSeenAt?.toISOString() ?? null,
  };
  return <Onboarding {...props} />;
}
