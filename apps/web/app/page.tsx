import Link from "next/link";
import { Landscape } from "./Landscape";
import { MeditatorFigure } from "./Meditator";

export default function Home() {
  return (
    <main className="hero">
      <Landscape />

      <nav className="hero-nav" aria-label="Main">
        <span className="brand">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          <span className="brand-name">Job Agent</span>
        </span>
        <Link className="btn ghost-glow" href="/board">
          Open board
        </Link>
      </nav>

      <section className="hero-card" aria-labelledby="hero-title">
        <p className="tag">
          <span className="tag-dot" aria-hidden /> Approval-first mode
        </p>
        <h1 id="hero-title" className="hero-title">
          You rest.
          <span className="hero-title-accent">We work.</span>
        </h1>
        <p className="hero-sub">
          Job Agent finds roles that fit, writes your CV and cover letter from
          verified facts only, and prefills the form. You say yes at every step,
          and you press submit.
        </p>
        <Link className="btn primary pill big" href="/board">
          Find my next job <span aria-hidden>→</span>
        </Link>
        <ul className="hero-pills">
          <li>Nothing invented, ever</li>
          <li>Every claim cites a fact</li>
          <li>You approve before anything is sent</li>
        </ul>
      </section>

      <MeditatorFigure />
    </main>
  );
}
