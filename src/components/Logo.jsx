// "Instant" - a bolt inside camera focus brackets. Chosen 3 Sep 2026 from
// the kiosk-led round of concepts: the brackets are the stand looking at an
// item, the bolt is how fast it's over. Two inks only, so it reverses onto
// the dark sidebar without a second artwork.
//
// Colors come from `currentColor` and the --logo-accent custom property, so
// a caller can drop it on any ground: set color for the brackets, and
// --logo-accent for the bolt.
export default function Logo({ size = 28, className = '', title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={'logo-mark ' + className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 20V12a3 3 0 0 1 3-3h8" />
        <path d="M45 9h8a3 3 0 0 1 3 3v8" />
        <path d="M56 44v8a3 3 0 0 1-3 3h-8" />
        <path d="M19 55h-8a3 3 0 0 1-3-3v-8" />
      </g>
      <path d="M37 14 L23 35 H31 L27 50 L42 29 H34 Z" fill="var(--logo-accent, #e0a72e)" />
    </svg>
  )
}
