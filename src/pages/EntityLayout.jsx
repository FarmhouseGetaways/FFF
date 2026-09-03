import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import Logo from '../components/Logo.jsx'

export default function EntityLayout() {
  const { entityId } = useParams()
  const location = useLocation()
  const [entity, setEntity] = useState(null)

  useEffect(() => {
    let active = true
    supabase
      .from('entities')
      .select('id, name, entity_type')
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
        <h2 className="sidebar-title">{entity?.name ?? '…'}</h2>
        <nav>
          {navGroups.map((group, i) => (
            <div className="sidebar-group" key={i}>
              {i > 0 && <hr className="sidebar-divider" />}
              {group.map((item) => (
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
              ))}
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
