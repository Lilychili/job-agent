import { PageShell } from "@/components/PageShell";
import { loadLatestExtraction, loadProfile, loadSettingsView } from "@/lib/data";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileTabs } from "./ProfileTabs";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [profile, extraction, settings] = await Promise.all([loadProfile(), loadLatestExtraction(), loadSettingsView()]);
  return (
    <PageShell
      title="Profile"
      tabs={<ProfileTabs active="about" />}
      lead="The facts every CV and cover letter is written from. Nothing is used by an agent until you confirm it."
    >
      <ProfileEditor
        initial={
          profile && {
            contact: profile.contact,
            facts: profile.facts,
            confirmed: profile.confirmed,
            version: profile.version,
            sourceFilePath: profile.sourceFilePath,
          }
        }
        extraction={extraction}
        aiReady={settings.ready}
      />
    </PageShell>
  );
}
