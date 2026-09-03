import { Link } from 'react-router-dom'

const FEATURES = [
  {
    title: 'Not another QuickBooks',
    body: 'No setup wizards, no accountant-speak, no forty menus you will never touch. Enter what came in and what went out — that is it. Real accounting for people who hate software.',
  },
  {
    title: 'Profit & Loss, done right',
    body: 'Every dollar in and out, categorized and rolled up into a clean P&L for any date range — no spreadsheet required.',
  },
  {
    title: 'Balance Sheet at a glance',
    body: 'See what every account is actually worth — checking, savings, cash box, Venmo — assets against liabilities, always current.',
  },
  {
    title: 'Built for multiple entities',
    body: 'Running a rental property and a farmstand? Track each one separately, with its own accounts, categories, and statements.',
  },
  {
    title: 'Cash, card, or Venmo',
    body: 'Log a bank transaction, a cash sale at the stand, or a Venmo payment the same way — everything lands in one ledger.',
  },
]

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-logo">Farmgirl Finance</span>
        <Link to="/login" className="landing-nav-cta">
          Log in
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden="true" />
        <p className="landing-eyebrow">Financial Freedom Farmgirl</p>
        <h1>Welcome to Farmgirl Finance</h1>
        <p className="landing-subhead">
          This software can be accessed anywhere — from the farmstand, the road, or the couch.
          Profit &amp; Loss and Balance Sheet statements for your properties and farmstand — built
          from real transactions, not guesswork. One place for every entity you run.
        </p>
        <div className="landing-cta-row">
          <Link to="/login" className="landing-cta-primary">
            Get started
          </Link>
          <a href="#pricing" className="landing-cta-secondary">
            See pricing
          </a>
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map((f) => (
          <div className="landing-feature-card" key={f.title}>
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
            <li>Unlimited entities — properties, farmstands, anything you run</li>
            <li>Profit &amp; Loss and Balance Sheet, any date range</li>
            <li>Manual, cash, and Venmo transaction entry</li>
            <li>Cancel anytime</li>
          </ul>
          <Link to="/login" className="landing-cta-primary landing-price-cta">
            Start now
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
