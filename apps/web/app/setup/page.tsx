import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { loadSetupStatus, setupProgress } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const s = await loadSetupStatus();
  const steps = [
    {
      href: "/settings",
      title: "Connect Claude",
      done: s.key,
      detail: s.key ? "Connected." : "Sign in with Claude Code (uses your subscription) or add an API key. About 2 minutes.",
      cta: s.key ? "Manage" : "Connect",
    },
    {
      href: "/profile",
      title: "Build and confirm your Profile",
      done: s.profile === "confirmed",
      detail:
        s.profile === "confirmed"
          ? `${s.factCount} facts confirmed.`
          : s.profile === "draft"
            ? `${s.factCount} facts in a draft. Review them and confirm.`
            : "Upload your CV or type it in. About 5 minutes.",
      cta: s.profile === "none" ? "Start" : s.profile === "draft" ? "Review" : "Edit",
    },
    {
      href: "/profile/looking-for",
      title: "Set your search criteria",
      done: s.preferences,
      detail: s.preferences ? "Saved." : "Locations, stack, exclusions and the companies to search. About 5 minutes.",
      cta: s.preferences ? "Edit" : "Set up",
    },
    {
      href: "/questions",
      title: "Answer the common questions",
      done: s.answerTotal > 0 && s.answered === s.answerTotal,
      detail: `${s.answered} of ${s.answerTotal} answered. Skip any; you'll be asked when a form needs it.`,
      cta: s.answered === 0 ? "Answer" : "Continue",
    },
  ];
  const { ready, started } = setupProgress(s);

  return (
    <PageShell title="Set up" lead="Four short steps. Do them in any order and come back to change anything, or let the guided setup walk you through.">
      {!ready && (
        <div>
          <Link className="btn primary" href="/welcome">
            Start guided setup →
          </Link>
        </div>
      )}
      <ol className="steps">
        {steps.map((st, i) => (
          <li key={st.href} className={`panel step${st.done ? " done" : ""}`}>
            <span className="step-num" aria-hidden>
              {st.done ? "✓" : i + 1}
            </span>
            <div className="step-body">
              <h2>{st.title}</h2>
              <p>{st.detail}</p>
            </div>
            <Link className={`btn${st.done ? "" : " primary"}`} href={st.href}>
              {st.cta}
            </Link>
          </li>
        ))}
      </ol>
      <div className="panel ready">
        <h2>{ready ? "You're ready" : "Almost there"}</h2>
        <p>
          {ready
            ? "Head to the board and run your first search."
            : "Finish the key, a confirmed Profile and your criteria, then search from the board."}
        </p>
        {started && (
          <Link className={`btn${ready ? " primary big" : ""}`} href="/board">
            Open the board
          </Link>
        )}
      </div>
    </PageShell>
  );
}
