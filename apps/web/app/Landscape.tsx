/**
 * Twilight hills with a single-line figure meditating in lotus pose.
 * Pure SVG, decorative only (aria-hidden), so it costs no requests and scales to any viewport.
 */
const LINE = {
  fill: "none",
  stroke: "#fff7ff",
  strokeWidth: 3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** One side of the body, drawn for the left; mirrored with scale(-1 1) for the right. */
function Side() {
  return (
    <g {...LINE}>
      {/* ear */}
      <path d="M-35 -334 C-47 -336 -47 -308 -34 -306" />
      {/* neck, shoulder and outer arm, flowing into the hand */}
      <path d="M-24 -278 C-26 -260 -46 -250 -74 -242 C-102 -232 -112 -212 -118 -186 C-126 -150 -142 -128 -160 -114" />
      {/* inner arm back to the armpit */}
      <path d="M-52 -184 C-62 -150 -92 -126 -130 -100" />
      {/* waist down into the thigh */}
      <path d="M-52 -184 C-50 -146 -58 -104 -66 -62" />
      {/* hand: palm and three soft fingers */}
      <path d="M-160 -114 C-176 -120 -184 -106 -182 -96 C-180 -86 -164 -86 -152 -92" />
      <path d="M-180 -104 C-190 -112 -196 -104 -190 -98" />
      <path d="M-174 -114 C-182 -126 -190 -120 -186 -112" />
      {/* chest spiral */}
      <path d="M-4 -140 C-30 -176 -64 -154 -52 -128 C-44 -110 -16 -118 -22 -140 C-26 -156 -50 -152 -44 -138" />
      {/* folded leg, soft and wide */}
      <path d="M-66 -62 C-90 -48 -130 -46 -168 -36 C-208 -24 -204 10 -150 14 C-100 18 -40 14 0 8" />
    </g>
  );
}

function Meditator() {
  return (
    <g filter="url(#glow)">
      {/* aura */}
      <circle cx="0" cy="-200" r="240" fill="url(#aura)" />
      <circle cx="0" cy="-200" r="212" {...LINE} strokeWidth={1.4} strokeDasharray="2 9" opacity="0.7" />

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
      <path {...LINE} d="M2 -366 C-6 -360 -4 -352 0 -348" strokeWidth={2} opacity="0.8" />
    </g>
  );
}

/**
 * The meditator as its own SVG so the page layout can stretch it to the hero card's height
 * (top and bottom aligned with the tile) at any window size.
 */
export function MeditatorFigure() {
  return (
    <div className="meditator-cell">
    <svg
      className="meditator"
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
      <Meditator />
    </svg>
    </div>
  );
}

export function Landscape() {
  return (
    <svg
      className="landscape"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9a6f5" />
          <stop offset="1" stopColor="#8f8cf0" />
        </linearGradient>
        <linearGradient id="hillMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8d8cf2" />
          <stop offset="1" stopColor="#5f6fe6" />
        </linearGradient>
        <linearGradient id="hillNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b78ec" />
          <stop offset="1" stopColor="#3b5bd9" />
        </linearGradient>
        <linearGradient id="hillFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f7ff0" />
          <stop offset="1" stopColor="#2f56d4" />
        </linearGradient>
      </defs>

      {/* distant ridges */}
      <path d="M0 470 Q180 380 360 450 T720 430 T1080 420 T1440 440 V900 H0Z" fill="url(#hillFar)" opacity="0.7" />
      <path d="M0 520 Q240 430 480 500 T960 470 T1440 500 V900 H0Z" fill="url(#hillMid)" opacity="0.85" />

      {/* cypress silhouettes */}
      {[
        [520, 470, 0.9],
        [585, 455, 1.15],
        [820, 450, 1],
        [1360, 470, 0.8],
      ].map(([x, y, s]) => (
        <path
          key={`${x}-${y}`}
          transform={`translate(${x} ${y}) scale(${s})`}
          d="M0 -62 C12 -40 14 -10 10 28 H-10 C-14 -10 -12 -40 0 -62Z"
          fill="#8b5fd6"
          opacity="0.55"
        />
      ))}

      <path d="M0 600 Q300 500 620 580 T1180 560 T1440 590 V900 H0Z" fill="url(#hillNear)" />

      {/* winding path */}
      <path
        d="M690 900 C700 800 560 760 640 700 C720 640 900 650 820 590"
        fill="none"
        stroke="#e8e5ff"
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.55"
      />

      <path d="M0 700 Q220 640 480 700 T980 690 T1440 720 V900 H0Z" fill="url(#hillFront)" />

      {/* meadow sparkle */}
      <g fill="#fff" opacity="0.5">
        {Array.from({ length: 46 }, (_, i) => (
          <circle key={i} cx={(i * 211) % 1440} cy={740 + ((i * 53) % 150)} r={1.2 + ((i * 7) % 3) * 0.6} />
        ))}
      </g>
    </svg>
  );
}
