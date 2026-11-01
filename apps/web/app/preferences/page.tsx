import { PageShell } from "@/components/PageShell";
import { loadPreferences } from "@/lib/data";
import { PreferencesForm, type PrefsValue } from "./PreferencesForm";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const p = await loadPreferences();
  const initial: PrefsValue = {
    locations: p?.locations ?? [],
    remote: p?.remote ?? "any",
    salaryFloor: p?.salaryFloor?.toString() ?? "",
    salaryCurrency: p?.salaryCurrency ?? "",
    stackMustHave: p?.stackMustHave ?? [],
    stackNiceToHave: p?.stackNiceToHave ?? [],
    exclusions: p?.exclusions ?? { companies: [], keywords: [], seniority: [] },
    companyBoards: p?.companyBoards ?? [],
  };
  return (
    <PageShell
      title="Preferences"
      lead="Hard criteria for Search. Jobs that break these are filtered out in code before any AI sees them."
    >
      <PreferencesForm initial={initial} />
    </PageShell>
  );
}
