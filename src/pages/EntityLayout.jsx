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

  const navItems = [
    { to: 'transactions', label: 'Transactions' },
    { to: 'import', label: 'Import CSV' },
    { to: 'profit-loss', label: 'Profit & Loss' },
    { to: 'balance-sheet', label: 'Balance Sheet' },
    { to: 'accounts', label: 'Accounts' },
    { to: 'categories', label: 'Categories' },
    { to: 'settings', label: 'Settings' },
  ]

  return (
    <div className="entity-shell">
      <aside className="sidebar">
        <Link to="/entities" className="sidebar-back">
          ← All entities
        </Link>
        <h2 className="sidebar-title">{entity?.name ?? '…'}</h2>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="entity-main">
        <Outlet context={{ entityId, entity, onEntityUpdated: setEntity }} />
      </main>
    </div>
  )
}
