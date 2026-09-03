import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function EntityLayout() {
  const { entityId } = useParams()
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
  const navGroups = [
    [
      { to: 'transactions', label: 'Transactions' },
      { to: 'profit-loss', label: 'Profit & Loss' },
      { to: 'balance-sheet', label: 'Balance Sheet' },
    ],
    [
      { to: 'accounts', label: 'Accounts' },
      { to: 'import', label: 'Import CSV' },
      { to: 'settings', label: 'Settings' },
    ],
  ]

  return (
    <div className="entity-shell">
      <aside className="sidebar">
        <Link to="/entities" className="sidebar-back">
          ← All entities
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
                  className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
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
