import { PageShell } from "@/components/PageShell";
import { loadDiscoveredCompanies, loadPreferences } from "@/lib/data";
import { ProfileTabs } from "../ProfileTabs";
import { DiscoveredCompanies } from "./DiscoveredCompanies";
import { PreferencesForm, type PrefsValue } from "./PreferencesForm";

export const dynamic = "force-dynamic";

export default async function LookingForPage() {
  const [p, discovered] = await Promise.all([loadPreferences(), loadDiscoveredCompanies()]);
  const initial: PrefsValue = {
    roles: p?.roles ?? [],
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
      title="Profile"
      tabs={<ProfileTabs active="looking-for" />}
      lead="Hard criteria for Search. Jobs that break these are filtered out in code before any AI sees them."
    >
      <PreferencesForm key={initial.exclusions.companies.join("\n")} initial={initial} />
      <DiscoveredCompanies companies={discovered} />
    </PageShell>
  );
}
