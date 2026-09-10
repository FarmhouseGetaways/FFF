// "Viewfinder" - four scan brackets holding a lens. The ivizhin mark
// (9 Sep 2026, replacing "Instant"): same four-corner language as the
// kiosk's own on-screen viewfinder, because recognizing an item held up
// to a camera is the whole product. Geometry matches the approved brand
// file exactly (120-unit grid, corner arms 24 units, radius 8, ring r21,
// pupil r7.5, stroke 5) - see Z:\...\iVision.ai\Logo\Ivizhin Logo Design.
//
// Colors come from `currentColor` and the --logo-accent custom property, so
// a caller can drop it on any ground: set color for the brackets, and
// --logo-accent for the ring and pupil (defaults to the brand accent).
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
      <circle cx="60" cy="60" r="21" fill="none" stroke="var(--logo-accent, #9184d9)" strokeWidth="5" />
      <circle cx="60" cy="60" r="7.5" fill="var(--logo-accent, #9184d9)" />
    </svg>
  )
}
