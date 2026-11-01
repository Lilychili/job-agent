/**
 * Twilight hills backdrop for the hero.
 * Pure SVG, decorative only (aria-hidden), so it costs no requests and scales to any viewport.
 */
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
