/** Original chrome bust. The red optic is the only warm light on the machine. */
export function MachineMark() {
  return (
    <div className="machine" aria-hidden>
      <svg className="machine-svg" viewBox="0 0 320 460">
        <defs>
          <linearGradient id="t8-plate" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#f5f8fb" />
            <stop offset="0.28" stopColor="#c5d0dc" />
            <stop offset="0.55" stopColor="#6e7c8d" />
            <stop offset="0.78" stopColor="#b7c3d0" />
            <stop offset="1" stopColor="#2c3440" />
          </linearGradient>
          <linearGradient id="t8-dark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a4452" />
            <stop offset="1" stopColor="#12161c" />
          </linearGradient>
          <linearGradient id="t8-jaw" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d5dee8" />
            <stop offset="0.5" stopColor="#7d8b9c" />
            <stop offset="1" stopColor="#1c232c" />
          </linearGradient>
          <radialGradient id="t8-eye" cx="42%" cy="38%" r="60%">
            <stop offset="0" stopColor="#fff7f4" />
            <stop offset="0.22" stopColor="#ff5a45" />
            <stop offset="0.55" stopColor="#ff1e12" />
            <stop offset="1" stopColor="#4a0906" />
          </radialGradient>
          <filter id="t8-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M28 392 L96 348 H224 L292 392 L270 448 H50 Z"
          fill="url(#t8-dark)"
          stroke="#9aabbc"
          strokeWidth="1.2"
        />
        <path d="M78 368 H242 L228 392 H92 Z" fill="#1a212a" />
        <path d="M108 392 H212 L204 424 H116 Z" fill="url(#t8-plate)" opacity="0.85" />

        <rect x="138" y="312" width="44" height="58" rx="8" fill="url(#t8-plate)" />
        <rect x="96" y="328" width="18" height="40" rx="6" fill="#8ea0b2" />
        <rect x="206" y="328" width="18" height="40" rx="6" fill="#5c6b7c" />
        <path d="M138 330 H182 M138 346 H182 M138 362 H182" stroke="#1c232c" strokeWidth="2" opacity="0.55" />

        <path
          d="M160 36 L222 62 L262 118 L274 178 L258 236 L214 270 H106 L62 236 L48 178 L58 118 L98 62 Z"
          fill="url(#t8-plate)"
        />
        <path
          d="M160 58 L208 80 L236 128 L244 176 L228 220 H92 L80 176 L86 128 L112 80 Z"
          fill="url(#t8-dark)"
        />
        <path
          d="M118 92 L156 70 L168 108 L132 124 Z"
          fill="#f7fbff"
          opacity="0.42"
        />

        <path
          d="M104 248 H216 L236 286 L214 338 L160 362 L106 338 L84 286 Z"
          fill="url(#t8-jaw)"
        />
        <path d="M124 268 H196 L188 292 H132 Z" fill="#0c1016" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={128 + i * 12} y="274" width="7" height="14" rx="1" fill="#d5dee8" opacity="0.88" />
        ))}
        <path d="M148 318 H172 L166 336 H154 Z" fill="#10151c" />

        <ellipse cx="116" cy="164" rx="26" ry="16" fill="#07090d" />
        <circle cx="116" cy="164" r="6" fill="#9aabbc" />
        <circle cx="114" cy="162" r="2" fill="#f4f8fb" />

        <g filter="url(#t8-glow)">
          <circle cx="204" cy="162" r="28" fill="#ff2a1c" opacity="0.28" />
          <circle cx="204" cy="162" r="16" fill="url(#t8-eye)" />
          <circle cx="198" cy="156" r="4" fill="#fff" opacity="0.9" />
        </g>

        <path d="M154 186 L166 186 L160 214 Z" fill="#07090d" />
        <path d="M160 46 V108" stroke="#1a212a" strokeWidth="1.4" opacity="0.45" />
        <circle cx="78" cy="150" r="4" fill="#1a212a" />
        <circle cx="246" cy="150" r="4" fill="#1a212a" />
        <circle cx="160" cy="248" r="3" fill="#1a212a" />
        <path d="M70 200 H98 M222 200 H252" stroke="#1a212a" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
      </svg>
    </div>
  );
}
