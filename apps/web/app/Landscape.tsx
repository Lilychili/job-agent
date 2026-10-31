/**
 * Twilight hills with wireframe mentors and newborn soul orbs.
 * Pure SVG, decorative only (aria-hidden), so it costs no requests and scales to any viewport.
 */
function Soul({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className="soul" style={{ animationDelay: `${delay}s` }}>
        <ellipse cx="0" cy="0" rx="22" ry="25" fill="url(#soulFill)" />
        <ellipse cx="-7" cy="-6" rx="7" ry="9" fill="#fff" opacity="0.35" />
        <circle cx="-7" cy="-2" r="2.4" fill="#1e1b4b" />
        <circle cx="8" cy="-2" r="2.4" fill="#1e1b4b" />
        <path d="M-5 9 q6 4 12 0" stroke="#1e1b4b" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    </g>
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
        <radialGradient id="soulFill" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#c9fbe6" />
          <stop offset="1" stopColor="#6ee7b7" />
        </radialGradient>
        <radialGradient id="doorGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff7d6" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff7d6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9d6" />
          <stop offset="1" stopColor="#f6c9e6" />
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* distant ridges */}
      <path d="M0 470 Q180 380 360 450 T720 430 T1080 420 T1440 440 V900 H0Z" fill="url(#hillFar)" opacity="0.7" />
      <path d="M0 520 Q240 430 480 500 T960 470 T1440 500 V900 H0Z" fill="url(#hillMid)" opacity="0.85" />

      {/* cypress silhouettes */}
      {[
        [520, 470, 0.9],
        [585, 455, 1.15],
        [980, 440, 1],
        [1230, 470, 0.8],
      ].map(([x, y, s]) => (
        <path
          key={`${x}-${y}`}
          transform={`translate(${x} ${y}) scale(${s})`}
          d="M0 -62 C12 -40 14 -10 10 28 H-10 C-14 -10 -12 -40 0 -62Z"
          fill="#8b5fd6"
          opacity="0.55"
        />
      ))}

      {/* dome with a lit doorway */}
      <g transform="translate(1180 360)">
        <ellipse cx="0" cy="150" rx="170" ry="40" fill="#6b5be0" opacity="0.35" />
        <path d="M-150 160 C-170 60 -90 -40 20 -50 C120 -56 190 20 170 160Z" fill="url(#dome)" />
        <circle cx="-20" cy="60" r="90" fill="url(#doorGlow)" opacity="0.5" />
        <path d="M-52 160 V84 a28 28 0 0 1 56 0 V160Z" fill="#fff7d6" filter="url(#glow)" />
        <circle cx="-24" cy="46" r="13" fill="none" stroke="#e8a64a" strokeWidth="2.5" opacity="0.8" />
      </g>

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

      {/* wireframe mentors */}
      <g className="mentor" fill="rgba(255,255,255,0.14)" stroke="#f3e8ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)">
        <g transform="translate(700 230)">
          <path d="M0 40 C-40 10 -20 -50 20 -50 C60 -50 90 -20 70 10 C60 30 40 34 34 50 C28 120 40 220 48 330 C30 340 10 340 -6 330 C-4 230 -10 140 0 40Z" />
          <circle cx="42" cy="-14" r="5" fill="#f3e8ff" />
          <path d="M-6 120 C-50 110 -70 90 -76 60" />
        </g>
        <g transform="translate(880 150)" className="mentor-b">
          <path d="M0 90 C-30 60 -24 10 6 -20 L-70 -40 L12 -50 C40 -90 70 -40 60 0 C56 30 46 56 46 90 C44 180 54 280 62 380 C44 388 20 388 8 380 C6 280 10 190 0 90Z" />
          <path d="M44 150 C80 140 100 120 104 100 L84 70 L50 90Z" fill="rgba(255,255,255,0.28)" />
          <circle cx="52" cy="-30" r="4" fill="#f3e8ff" />
        </g>
      </g>

      {/* fresh souls */}
      <Soul x={80} y={640} s={1} delay={0} />
      <Soul x={150} y={670} s={0.8} delay={0.6} />
      <Soul x={250} y={610} s={0.7} delay={1.2} />
      <Soul x={700} y={640} s={0.6} delay={0.3} />

      <path d="M0 700 Q220 640 480 700 T980 690 T1440 720 V900 H0Z" fill="url(#hillFront)" />
      {/* meadow sparkle */}
      <g fill="#fff" opacity="0.5">
        {Array.from({ length: 46 }, (_, i) => (
          <circle key={i} cx={(i * 211) % 1440} cy={740 + ((i * 53) % 150)} r={1.2 + ((i * 7) % 3) * 0.6} />
        ))}
      </g>

      <Soul x={1040} y={760} s={1.25} delay={0.9} />
      <g transform="translate(1110 790)">
        <g className="soul" style={{ animationDelay: "0.2s" }}>
          <path d="M-18 40 C-24 -10 -10 -44 8 -46 C28 -44 34 -10 26 40Z" fill="url(#soulFill)" />
          <path d="M-14 -40 L-4 -62 L22 -54 L20 -38Z" fill="#4a46c8" />
          <circle cx="-2" cy="-16" r="2.6" fill="#1e1b4b" />
          <circle cx="16" cy="-16" r="2.6" fill="#1e1b4b" />
          <ellipse cx="7" cy="2" rx="4" ry="5" fill="#1e1b4b" />
        </g>
      </g>
    </svg>
  );
}
