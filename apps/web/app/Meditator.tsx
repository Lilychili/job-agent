"use client";

import { useEffect, useRef } from "react";

/**
 * A single-line figure in lotus pose that assembles itself: a stream of 0s and 1s leaves the card
 * side, settles along the outline, and each digit gives way to the smooth line as it is drawn.
 * Pure SVG + CSS; with reduced motion (or if measuring fails) the finished figure is shown at once.
 */
const LINE = {
  className: "fig-line",
  pathLength: 1,
  fill: "none",
  stroke: "#fff7ff",
  strokeWidth: 3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** One side of the body, drawn for the left; mirrored with scale(-1 1) for the right. */
function Side() {
  return (
    <g>
      {/* ear */}
      <path {...LINE} d="M-35 -334 C-47 -336 -47 -308 -34 -306" />
      {/* neck, shoulder and outer arm, flowing into the hand */}
      <path {...LINE} d="M-24 -278 C-26 -260 -46 -250 -74 -242 C-102 -232 -112 -212 -118 -186 C-126 -150 -142 -128 -160 -114" />
      {/* inner arm back to the armpit */}
      <path {...LINE} d="M-52 -184 C-62 -150 -92 -126 -130 -100" />
      {/* waist down into the thigh */}
      <path {...LINE} d="M-52 -184 C-50 -146 -58 -104 -66 -62" />
      {/* hand: palm and three soft fingers */}
      <path {...LINE} d="M-160 -114 C-176 -120 -184 -106 -182 -96 C-180 -86 -164 -86 -152 -92" />
      <path {...LINE} d="M-180 -104 C-190 -112 -196 -104 -190 -98" />
      <path {...LINE} d="M-174 -114 C-182 -126 -190 -120 -186 -112" />
      {/* chest spiral */}
      <path {...LINE} d="M-4 -140 C-30 -176 -64 -154 -52 -128 C-44 -110 -16 -118 -22 -140 C-26 -156 -50 -152 -44 -138" />
      {/* folded leg, soft and wide */}
      <path {...LINE} d="M-66 -62 C-90 -48 -130 -46 -168 -36 C-208 -24 -204 10 -150 14 C-100 18 -40 14 0 8" />
    </g>
  );
}

function Figure() {
  return (
    <g filter="url(#glow)">
      <circle className="fig-aura" cx="0" cy="-200" r="240" fill="url(#aura)" />
      <circle className="fig-aura" cx="0" cy="-200" r="212" fill="none" stroke="#fff7ff" strokeWidth={1.4} strokeDasharray="2 9" opacity="0.7" />

      <Side />
      <g transform="scale(-1 1)">
        <Side />
      </g>

      {/* the unbroken line: crossed ankles, then straight up through the spine to the face */}
      <path
        {...LINE}
        d="M-150 14 C-90 26 -20 24 40 14 C74 8 96 8 108 4 M0 8 C-6 -10 -8 -40 -2 -90 C4 -140 6 -200 2 -250 C0 -266 2 -274 2 -284"
      />

      {/* head */}
      <path {...LINE} d="M-24 -278 C-42 -298 -42 -338 -20 -364 C-8 -378 10 -378 22 -364 C44 -338 42 -298 24 -278" />
      {/* mouth: a small knot where the line meets the face */}
      <path {...LINE} d="M2 -284 C-9 -288 -10 -300 0 -302 C9 -302 10 -292 2 -292" />
      {/* infinity on the forehead */}
      <path
        {...LINE}
        d="M0 -338 C-8 -352 -22 -350 -22 -338 C-22 -326 -8 -324 0 -338 C8 -352 22 -350 22 -338 C22 -326 8 -324 0 -338Z"
      />
      {/* top knot */}
      <path {...LINE} d="M-4 -374 C-24 -390 -16 -416 4 -414 C24 -412 22 -388 2 -386 C-10 -385 -12 -398 -2 -400" />
      <path {...LINE} d="M2 -366 C-6 -360 -4 -352 0 -348" strokeWidth={2} />
    </g>
  );
}

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP = 10; // user units between digits along the outline
const DT = 0.011; // seconds between consecutive digits
const START = 0.3; // seconds before the first digit leaves
const ORIGIN = { x: -215, y: 8 }; // where the stream emerges: the card side, at seat height

export function MeditatorFigure() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const showStatic = () => svg.classList.remove("assemble");

    const layer = svg.querySelector<SVGGElement>(".fig-digits");
    const screen = svg.getScreenCTM();
    if (!layer || !screen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      showStatic();
      return;
    }
    const toSvg = screen.inverse();

    let n = 0;
    for (const path of svg.querySelectorAll<SVGPathElement>("path.fig-line")) {
      const count = Math.max(1, Math.floor(path.getTotalLength() / STEP));
      const toRoot = toSvg.multiply(path.getScreenCTM() ?? screen);
      const drawDelay = START + n * DT + 0.3;
      const drawDur = count * DT + 0.5;
      path.style.setProperty("--draw-delay", `${drawDelay}s`);
      path.style.setProperty("--draw-dur", `${drawDur}s`);

      for (let k = 0; k < count; k++) {
        const pt = path.getPointAtLength((k / count) * path.getTotalLength());
        const p = new DOMPoint(pt.x, pt.y).matrixTransform(toRoot); // undo the mirror so digits stay upright
        const glyph = document.createElementNS(SVG_NS, "text");
        glyph.setAttribute("x", p.x.toFixed(1));
        glyph.setAttribute("y", p.y.toFixed(1));
        glyph.textContent = Math.random() < 0.5 ? "0" : "1";
        glyph.style.setProperty("--dx", `${(ORIGIN.x - p.x).toFixed(1)}px`);
        glyph.style.setProperty("--dy", `${(ORIGIN.y - p.y).toFixed(1)}px`);
        glyph.style.setProperty("--fly", `${(START + (n + k) * DT).toFixed(3)}s`);
        glyph.style.setProperty("--vanish", `${(drawDelay + drawDur * (k / count)).toFixed(3)}s`);
        layer.appendChild(glyph);
      }
      n += count;
    }
    svg.style.setProperty("--aura-delay", `${(START + n * DT * 0.5).toFixed(2)}s`);
    svg.classList.add("ready");

    return () => {
      layer.replaceChildren();
      svg.classList.remove("ready");
    };
  }, []);

  return (
    <div className="meditator-cell">
      <svg
        ref={ref}
        className="meditator assemble"
        viewBox="-215 -422 430 446"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="aura" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff7d6" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#f8acff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#f8acff" stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <ellipse cx="0" cy="12" rx="190" ry="12" fill="#2a3fb0" opacity="0.35" />
        <Figure />
        <g className="fig-digits" filter="url(#glow)" />
      </svg>
    </div>
  );
}
