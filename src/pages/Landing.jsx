import { Link } from 'react-router-dom'
import Logo from '../components/Logo.jsx'
import { useAuth } from '../lib/AuthContext.jsx'

// Each card gets its own glyph rather than a colored bar on top - five
// near-identical text blocks read as one grey wall, and the bar colors
// (including a red one) didn't mean anything.
const ICONS = {
  scan: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <path d="M12 15v-4" />
      <path d="M9.5 9.5c1 -1.6 4 -1.6 5 0" />
    </>
  ),
  simple: (
    <>
      <path d="M5 12l4.5 4.5L19 7" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-5" />
      <path d="M12 20V9" />
      <path d="M17 20v-8" />
    </>
  ),
  scales: (
    <>
      <path d="M12 4v16" />
      <path d="M6 20h12" />
      <path d="M4 9h16" />
      <path d="M7 9l-3 5h6z" />
      <path d="M17 9l-3 5h6z" />
    </>
  ),
  entities: (
    <>
      <path d="M3 20V11l4-3 4 3v9" />
      <path d="M13 20v-6l4-3 4 3v6" />
      <path d="M3 20h18" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v1" />
      <path d="M4 8v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a1 1 0 0 0-1-1H6" />
      <path d="M16.5 13.5h.01" />
    </>
  ),
}

const FEATURES = [
  {
    icon: 'scan',
    accent: 'gold',
    title: 'Ring it up by looking at it',
    body: 'Hold an item up to the stand’s camera and it knows what it is and what it costs. No barcode gun, no keypad, no line — and every sale lands in your books on its own.',
  },
  {
    icon: 'simple',
    accent: 'green',
    title: 'Not another QuickBooks',
    body: 'No setup wizards, no accountant-speak, no forty menus you will never touch. Enter what came in and what went out — that is it. Real accounting for people who hate software.',
  },
  {
    icon: 'chart',
    accent: 'gold',
    title: 'Profit & Loss, done right',
    body: 'Every dollar in and out, categorized and rolled up into a clean P&L for any date range. No spreadsheet required — but export one the moment you need it.',
  },
  {
    icon: 'scales',
    accent: 'green',
    title: 'Balance Sheet at a glance',
    body: 'See what every account is actually worth — checking, savings, cash box, Venmo — assets against liabilities, always current, always easy.',
  },
  {
    icon: 'entities',
    accent: 'gold',
    title: 'Built for more than one business',
    body: 'Running a rental property and a farmstand, or even more? Track each one separately, with its own accounts, categories, statements and inventories — then see them all added together on one screen.',
  },
  {
    icon: 'wallet',
    accent: 'green',
    title: 'Cash, card, or Venmo',
    body: 'Log a bank transaction, a cash sale at the stand, or a Venmo payment the same way — everything lands in one ledger.',
  },
]

export default function Landing() {
  // Someone already signed in who lands here (a bookmark, the "Back to
  // home" link, or just typing the domain) was being shown "Log in" as if
  // they were a stranger, with no way back to their own books.
  const { user, loading } = useAuth()

  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-logo">
          <Logo size={30} />
          Farmgirl Finance
        </span>
        {loading ? null : user ? (
          <Link to="/entities" className="landing-nav-cta">
            Go to my dashboard →
          </Link>
        ) : (
          <Link to="/login" className="landing-nav-cta">
            Log in
          </Link>
        )}
      </header>

      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden="true" />
        <p className="landing-eyebrow">Financial Freedom Farmgirl</p>
        <h1>
          Welcome to
          <br />
          Farmgirl&nbsp;Finance
        </h1>
        <p className="landing-subhead">
          Profit &amp; Loss and Balance Sheet statements, available anywhere, on demand, from your
          computer or your phone — built from real transactions, not guesswork. One place for every
          business you run.
        </p>
        <div className="landing-cta-row">
          <Link to={user ? '/entities' : '/login'} className="landing-cta-primary">
            {user ? 'Go to my dashboard' : 'Get started'}
          </Link>
          <a href="#pricing" className="landing-cta-secondary">
            See pricing
          </a>
        </div>
      </section>

      <section className="landing-spotlight">
        <div className="landing-spotlight-inner">
          <p className="landing-eyebrow">Automated self-checkout</p>
          <h2>The checkout that runs itself</h2>
          <p className="landing-spotlight-body">
            Hold a product up to the camera and it just knows — what it is, what it costs, and it&apos;s
            in the books before the tap-to-pay beep finishes. No barcode scanner. No point-of-sale
            terminal. Nobody standing behind a counter. This is the kind of tech big retailers spend
            seven figures building — made simple and affordable enough for a bootstrapped farmstand to
            run from day one, and customers notice every single time.
          </p>
          <div className="landing-spotlight-chips">
            <span>No barcode scanner</span>
            <span>No POS hardware</span>
            <span>Every sale logs itself</span>
          </div>
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map((f) => (
          <div className="landing-feature-card" key={f.title}>
            <span className={'feature-icon feature-icon--' + f.accent} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[f.icon]}
              </svg>
            </span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>

      <section className="landing-pricing" id="pricing">
        <div className="landing-pricing-card">
          <p className="landing-eyebrow">One simple plan</p>
          <div className="landing-price">
            <span className="landing-price-amount">$27</span>
            <span className="landing-price-period">/ month</span>
          </div>
          <ul className="landing-price-list">
            <li>Camera-based self-checkout — hold it up, it&apos;s priced and logged automatically</li>
            <li>Unlimited businesses — properties, farmstands, anything you run</li>
            <li>Profit &amp; Loss and Balance Sheet, any date range</li>
            <li>Manual, cash, and Venmo transaction entry</li>
            <li>Cancel anytime</li>
          </ul>
          <Link to={user ? '/entities' : '/login'} className="landing-cta-primary landing-price-cta">
            {user ? 'Go to my dashboard' : 'Start now'}
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span>Farmgirl Finance — part of the Financial Freedom Farmgirl program</span>
        <a
          href="https://www.instagram.com/financialfreedomfarmgirl/"
          target="_blank"
          rel="noreferrer"
          className="landing-footer-link"
        >
          @financialfreedomfarmgirl
        </a>
      </footer>
    </div>
  )
}
