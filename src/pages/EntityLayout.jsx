import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import Logo from '../components/Logo.jsx'
import { openPos, getPosEntities } from '../lib/posHandoff.js'

const POS_URL = import.meta.env.VITE_POS_URL || 'https://mbm-checkout.netlify.app/logs'

export default function EntityLayout() {
  const { entityId } = useParams()
  const location = useLocation()
  const [entity, setEntity] = useState(null)
  // Whether this business has a kiosk, live or ordered - see getPosEntities.
  const [posEntities, setPosEntities] = useState(undefined)
  useEffect(() => {
    let live = true
    getPosEntities().then((s) => { if (live) setPosEntities(s) })
    return () => { live = false }
  }, [])
  const showPos = posEntities === null || (posEntities !== undefined && posEntities.has(entityId))

  useEffect(() => {
    let active = true
    supabase
      .from('entities')
      .select('id, name, entity_type, logo_url')
      .eq('id', entityId)
      .single()
      .then(({ data }) => {
        if (active) setEntity(data)
      })
    return () => {
      active = false
    }
  }, [entityId])

  // Two groups: what you came to find out, then the plumbing you set up
  // once and rarely touch. Categories moved under Settings - it's
  // configuration, not something you visit while doing the books.
  // Profit & Loss and Balance Sheet merged into one "Money" page, 3 Sep
  // 2026 (Cory: not an accountant, two separate statements for related
  // numbers was confusing) - see Money.jsx.
  const navGroups = [
    [
      { to: 'transactions', label: 'Transactions' },
      { to: 'money', label: 'Money', alsoActiveOn: ['profit-loss', 'balance-sheet'] },
      { to: 'inventory', label: 'Inventory' },
      // What was ordered against what sold, closed out each day (14 Sep 2026).
      { to: 'daily-count', label: 'The Numbers' },
      // What those counts add up to over time - sell-through, and margin
      // per vendor (16 Sep 2026).
      { to: 'trends', label: 'Trends' },
      // Stocking the stand against running it (16 Sep 2026).
      { to: 'cost-snapshot', label: 'Cost Snapshot' },
      // The checkout stand. It is a separate site, so this is a real link
      // out rather than a route - but it belongs in this list, because from
      // the owner's side the stand is part of the business, not a different
      // product. There was no way to reach it from here at all (Cory, 6 Sep
      // 2026). VITE_POS_URL lets a deployment point it somewhere else.
      // Only for a business with a kiosk, live or ordered (13 Sep 2026).
      ...(showPos ? [{ pos: true, label: 'POS' }] : []),
    ],
    [
      { to: 'accounts', label: 'Accounts' },
      { to: 'import', label: 'Import CSV' },
      // Categories lives under Settings now, so keep Settings lit while
      // you're in there - otherwise nothing in the sidebar is active and
      // you lose your place.
      { to: 'settings', label: 'Settings', alsoActiveOn: ['categories'] },
    ],
  ]

  return (
    <div className="entity-shell">
      <aside className="sidebar">
        {/* The only way back to the summary from inside an entity, so it
            reads as a real Home button rather than a faint text link. */}
        <Link to="/entities" className="sidebar-home">
          <Logo size={20} />
          Home
        </Link>
        {/* The logo rides with the name in the sidebar, which is on every
            screen - Cory, 16 Sep 2026: "so there is no question where
            someone is at". */}
        {entity?.logo_url && <img className="sidebar-logo" src={entity.logo_url} alt="" />}
        <h2 className="sidebar-title">{entity?.name ?? '…'}</h2>
        <nav>
          {navGroups.map((group, i) => (
            <div className="sidebar-group" key={i}>
              {i > 0 && <hr className="sidebar-divider" />}
              {group.map((item) =>
                item.pos ? (
                  /* Hands off with THIS business's id, so it opens that
                     business's stand already signed in. From here the entity
                     is unambiguous, which is why this is the better door. */
                  <button
                    key="pos"
                    className="sidebar-link"
                    onClick={() => openPos(entityId)}
                  >
                    {item.label} ↗
                  </button>
                ) : item.href ? (
                  <a
                    key={item.href}
                    className="sidebar-link"
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.label} ↗
                  </a>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      'sidebar-link' +
                      (isActive || item.alsoActiveOn?.some((p) => location.pathname.endsWith(`/${p}`))
                        ? ' active'
                        : '')
                    }
                  >
                    {item.label}
                  </NavLink>
                )
              )}
            </div>
          ))}
        </nav>
      </aside>
      <main className="entity-main">
        <Outlet context={{ entityId, entity, onEntityUpdated: setEntity }} />
      </main>
    </div>
  )
}
