// Farmgirl Finance's own mark. The frame - four scan brackets on a
// 120-unit grid - now matches ivizhin's (9 Sep 2026, Cory: "I want the
// frame to match ivizhin"), so the two read as one family: same viewfinder
// language, different centre glyph. Here it's an uptick - the books
// trending the right way - in green, not ivizhin's purple ring and pupil.
//
// Colors come from `currentColor` and the --logo-accent custom property, so
// a caller can drop it on any ground: set color for the brackets, and
// --logo-accent for the uptick (defaults to the brand green).
export default function Logo({ size = 28, className = '', title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={'logo-mark ' + className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 34 L10 18 Q10 10 18 10 L34 10" />
        <path d="M86 10 L102 10 Q110 10 110 18 L110 34" />
        <path d="M110 86 L110 102 Q110 110 102 110 L86 110" />
        <path d="M34 110 L18 110 Q10 110 10 102 L10 86" />
      </g>
      <path
        d="M38 80 L80 38 M60 38 L80 38 L80 58"
        fill="none"
        stroke="var(--logo-accent, #3f8f5c)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
