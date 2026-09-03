import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext.jsx'
import { useIsAdmin } from '../lib/useIsAdmin.js'
import { labelForType, BUILT_IN_TYPES } from '../lib/entityTypes'
import { formatMoney, todayISO } from '../lib/money'
import EntityTypePicker from '../components/EntityTypePicker.jsx'
import HomeSummary from '../components/HomeSummary.jsx'
import Logo from '../components/Logo.jsx'

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv(filename, rows) {
  const header = ['Name', 'Type']
  const lines = [header.join(',')]
  for (const r of rows) lines.push([r.name, r.entity_type].map(csvCell).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// sort_order is NULL for every row until it's been dragged at least once
// (added in migration 0007, ahead of this feature) — treat null as "goes
// last" and lean on Array.sort's stability to keep untouched rows in
// their original created_at order relative to each other.
function sortEntities(list) {
  return [...list].sort((a, b) => {
    const as = a.sort_order == null ? Infinity : a.sort_order
    const bs = b.sort_order == null ? Infinity : b.sort_order
    return as - bs
  })
}

// Sub-headings on Your Entities, per Cory's "Property" / "Farmstand" example
// (2 Sep 2026) — same ordering convention as useEntityTypes() in
// entityTypes.js: the three built-ins first, then any custom type (added
// since entity_type went free-text in migration 0008) alphabetically after.
// Only groups that actually have an entity in them get a heading.
function groupEntities(list) {
  const order = BUILT_IN_TYPES.map((t) => t.value)
  const seen = new Set(order)
  const extra = []
  list.forEach((e) => {
    if (e.entity_type && !seen.has(e.entity_type)) {
      seen.add(e.entity_type)
      extra.push(e.entity_type)
    }
  })
  extra.sort((a, b) => labelForType(a).localeCompare(labelForType(b)))
  return [...order, ...extra]
    .map((type) => ({ type, label: labelForType(type), items: sortEntities(list.filter((e) => e.entity_type === type)) }))
    .filter((g) => g.items.length > 0)
}

export default function EntityPicker() {
  const { user, signOut } = useAuth()
  const { isAdmin } = useIsAdmin()
  const [entities, setEntities] = useState(null)
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('property')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A browser download gives no visible feedback of its own - the file just
  // appears somewhere you aren't looking. Say where it went.
  const [notice, setNotice] = useState('')
  // Renaming was only possible from a business's own Settings page, which
  // nobody found - "Settings" doesn't say "rename". It lives on the row now.
  const [renamingId, setRenamingId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  // This month's numbers per business. The sidebar is how you PICK a
  // business; the main window shouldn't repeat that list, it should tell
  // you something the sidebar can't - which of them is actually earning.
  const [perEntity, setPerEntity] = useState(null)

  useEffect(() => {
    let active = true
    const monthStart = () => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    }

    async function loadTotals() {
      const [{ data: txns }, { data: balances }] = await Promise.all([
        supabase
          .from('transactions')
          .select('amount, entity_id')
          .not('category_id', 'is', null)
          .gte('txn_date', monthStart())
          .lte('txn_date', todayISO()),
        supabase.from('account_balances').select('balance, account_type, is_archived, entity_id'),
      ])
      if (!active) return

      const blank = () => ({ inn: 0, out: 0, onHand: 0 })
      const map = {}
      for (const t of txns ?? []) {
        if (!map[t.entity_id]) map[t.entity_id] = blank()
        const amt = Number(t.amount)
        if (amt >= 0) map[t.entity_id].inn += amt
        else map[t.entity_id].out += Math.abs(amt)
      }
      // Same asset-only rule as HomeSummary: liabilities are stored
      // negative, and folding them in would make "on hand" mean something
      // else entirely.
      const ASSETS = ['checking', 'savings', 'cash', 'venmo', 'other_asset']
      for (const b of balances ?? []) {
        if (b.is_archived || !ASSETS.includes(b.account_type)) continue
        if (!map[b.entity_id]) map[b.entity_id] = blank()
        map[b.entity_id].onHand += Number(b.balance)
      }
      setPerEntity(map)
    }

    loadTotals()
    return () => {
      active = false
    }
  }, [entities])
  const [showArchived, setShowArchived] = useState(false)
  const [dragId, setDragId] = useState(null)

  async function loadEntities() {
    const { data, error } = await supabase
      .from('entities')
      .select('id, name, entity_type, is_archived, sort_order')
      .order('created_at', { ascending: true })
    if (error) setError(error.message)
    else setEntities(data)
  }

  useEffect(() => {
    loadEntities()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    const { data: userData } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('entities')
      .insert({ name: name.trim(), entity_type: entityType, owner_id: userData.user.id })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    loadEntities()
  }

  function startRename(entity) {
    setRenamingId(entity.id)
    setRenameDraft(entity.name)
    setError('')
  }

  async function saveRename(id) {
    const next = renameDraft.trim()
    if (!next) {
      setError('A business needs a name.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('entities').update({ name: next }).eq('id', id)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setRenamingId(null)
    setRenameDraft('')
    setNotice(`Renamed to “${next}”.`)
    loadEntities()
  }

  async function setArchived(id, archived, name) {
    if (archived && !window.confirm(`Archive ${name}? It'll drop off this list, but you can reinstate it anytime from "View archived businesses."`)) {
      return
    }
    setBusy(true)
    await supabase.from('entities').update({ is_archived: archived }).eq('id', id)
    await loadEntities()
    setBusy(false)
  }

  // Dropping only reorders within the group being dragged in — there's no
  // affordance for dragging an entity into a different type's section, and
  // doing that silently would be a surprising way to change its type.
  // Persists by rewriting sort_order 0..N-1 for the whole group so ties
  // (everyone still null, or a stale value) can't reappear next reorder.
  async function handleDrop(groupItems, targetId) {
    const draggedId = dragId
    setDragId(null)
    if (!draggedId || draggedId === targetId) return
    const ids = groupItems.map((e) => e.id)
    const fromIdx = ids.indexOf(draggedId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...ids]
    reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, draggedId)

    const sortOrderById = new Map(reordered.map((id, i) => [id, i]))
    setEntities((prev) => prev.map((e) => (sortOrderById.has(e.id) ? { ...e, sort_order: sortOrderById.get(e.id) } : e)))

    setBusy(true)
    await Promise.all(reordered.map((id, i) => supabase.from('entities').update({ sort_order: i }).eq('id', id)))
    await loadEntities()
    setBusy(false)
  }

  const visibleEntities = entities ? entities.filter((e) => (showArchived ? e.is_archived : !e.is_archived)) : null
  const groups = visibleEntities ? groupEntities(visibleEntities) : []
  // Flattened but still in the grouped order (built-in types first, then
  // custom ones), so the table reads in the same sequence the sidebar does
  // and a drag lands where you'd expect.
  const orderedEntities = groups.flatMap((g) => g.items)

  const firstName = (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    'there'
  ).split(' ')[0]

  // The old line said "start by picking one of your businesses below" - but
  // what's immediately below is the summary, not the business list. Point at
  // what's actually next.
  const startByText =
    entities && entities.length === 0
      ? 'Start by adding your first business below.'
      : "Here's where your money stands today."

  const activeEntities = entities ? entities.filter((e) => !e.is_archived) : null

  return (
    // Same left column as every page inside a business, for two reasons.
    // One, the layout stops jumping when you click into a business and back.
    // Two, and the real point: the businesses are now permanent navigation
    // instead of a list buried under a screen of numbers, so "pick a
    // business to see its own numbers" is visible without reading anything.
    <div className="entity-shell">
      <aside className="sidebar">
        <Link to="/" className="sidebar-home">
          <Logo size={20} />
          Farmgirl Finance
        </Link>
        <h2 className="sidebar-title">Your businesses</h2>
        <nav>
          <div className="sidebar-group">
            {activeEntities === null && <span className="sidebar-empty">Loading…</span>}
            {activeEntities?.length === 0 && (
              <span className="sidebar-empty">None yet — add one on the right.</span>
            )}
            {activeEntities?.map((e) => (
              <Link key={e.id} to={`/entities/${e.id}`} className="sidebar-link">
                {e.name}
              </Link>
            ))}
          </div>
        </nav>
      </aside>

      <main className="entity-main">
    <div className="page">
      <header className="page-header">
        <h1 className="brand-lockup">
          <Logo size={32} />
          Farmgirl Finance
        </h1>
        <div className="page-header-actions">
          <Link to="/" className="header-btn">
            ← Back to home
          </Link>
          {isAdmin && (
            <Link to="/admin" className="header-btn">
              Admin
            </Link>
          )}
          <button className="header-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {!showArchived && (
        <div className="home-greeting">
          <h2 className="home-greeting-title">Hello, {firstName}.</h2>
          <p className="home-greeting-subtitle">{startByText}</p>
        </div>
      )}

      {!showArchived && (
        <>
          <h2 className="section-title">Your money at a glance</h2>
          <p className="page-subtitle">
            Everything added together, across every business you run.
          </p>
          <HomeSummary />
        </>
      )}

      <h2 className="section-title section-title--lead">
        {showArchived ? 'Archived businesses' : 'How each business is doing'}
      </h2>
      <p className="page-subtitle">
        {showArchived
          ? 'Businesses you’ve put away. Reinstate one anytime to bring it back.'
          : 'The same month, split out per business, so you can see which ones are earning and which are costing. Pick one from the left to open it.'}
      </p>

      <div className="page-actions">
        <button className="header-btn" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? '← Back to active businesses' : 'View archived businesses'}
        </button>
        {!showArchived && visibleEntities && visibleEntities.length > 0 && (
          <button
            className="header-btn"
            onClick={() => {
              downloadCsv('entities.csv', visibleEntities)
              setNotice('CSV downloaded — check your browser’s Downloads folder for entities.csv.')
            }}
          >
            Download CSV
          </button>
        )}
      </div>

      {notice && <p className="form-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {visibleEntities === null && <p>Loading…</p>}

      {visibleEntities && visibleEntities.length === 0 && (
        <p className="empty-state">
          {showArchived
            ? 'No archived businesses.'
            : 'No businesses yet — add your first property or farmstand below.'}
        </p>
      )}

      {orderedEntities.length > 0 && (
        <div className="table-scroll">
          <table className="data-table business-table">
            <thead>
              <tr>
                {!showArchived && <th aria-label="Drag to reorder" />}
                <th>Business</th>
                <th>Type</th>
                {!showArchived && (
                  <>
                    <th className="num">Incoming</th>
                    <th className="num">Outgoing</th>
                    <th className="num">Profit</th>
                    <th className="num">On hand</th>
                  </>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {orderedEntities.map((entity) => {
                const t = perEntity?.[entity.id]
                const net = t ? t.inn - t.out : 0
                const editing = renamingId === entity.id
                return (
                  <tr
                    key={entity.id}
                    draggable={!showArchived && !editing}
                    onDragStart={() => setDragId(entity.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(orderedEntities, entity.id)}
                    onDragEnd={() => setDragId(null)}
                    style={{ opacity: dragId === entity.id ? 0.5 : 1 }}
                  >
                    {!showArchived && (
                      <td
                        aria-hidden="true"
                        style={{ color: 'var(--muted, #888)', userSelect: 'none', cursor: editing ? 'default' : 'grab' }}
                      >
                        ⠿
                      </td>
                    )}
                    <td>
                      {editing ? (
                        <div className="row-actions">
                          <input
                            className="entity-rename-input"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveRename(entity.id)
                              if (e.key === 'Escape') setRenamingId(null)
                            }}
                            aria-label="Business name"
                            autoFocus
                          />
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busy}
                            onClick={() => saveRename(entity.id)}
                          >
                            Save
                          </button>
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busy}
                            onClick={() => setRenamingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : showArchived ? (
                        <span className="business-name">{entity.name}</span>
                      ) : (
                        <Link to={`/entities/${entity.id}`} className="business-name-link" draggable={false}>
                          {entity.name}
                        </Link>
                      )}
                    </td>
                    <td>
                      <span className="entity-type">{labelForType(entity.entity_type)}</span>
                    </td>
                    {!showArchived && (
                      <>
                        <td className="num positive">{t ? formatMoney(t.inn) : '—'}</td>
                        <td className="num negative">{t ? formatMoney(t.out) : '—'}</td>
                        <td className={'num ' + (net > 0 ? 'positive' : net < 0 ? 'negative' : '')}>
                          {t ? formatMoney(net) : '—'}
                        </td>
                        <td className="num">{t ? formatMoney(t.onHand) : '—'}</td>
                      </>
                    )}
                    <td>
                      {editing ? null : showArchived ? (
                        <div className="row-actions">
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busy}
                            onClick={() => {
                              downloadCsv(`${entity.name}.csv`, [entity])
                              setNotice(
                                `CSV downloaded — check your browser’s Downloads folder for ${entity.name}.csv.`,
                              )
                            }}
                          >
                            Download
                          </button>
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busy}
                            onClick={() => setArchived(entity.id, false)}
                          >
                            Reinstate
                          </button>
                        </div>
                      ) : (
                        <div className="row-actions">
                          <Link to={`/entities/${entity.id}`} className="header-btn header-btn--sm" draggable={false}>
                            Open
                          </Link>
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busy}
                            onClick={() => startRename(entity)}
                          >
                            Rename
                          </button>
                          <button
                            className="header-btn header-btn--sm header-btn--danger"
                            disabled={busy}
                            onClick={() => setArchived(entity.id, true, entity.name)}
                          >
                            Archive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!showArchived && (
        <form className="inline-form" onSubmit={handleCreate}>
          {/* "Business", not "entity" - the list above it says businesses,
              and the two words meaning the same thing on one screen is
              exactly the kind of thing that makes this feel like software
              written for accountants. */}
          <h2>Add a business</h2>
          <p className="page-subtitle">
            Add another business to track here. Each one keeps its own transactions, accounts and
            profit — nothing mixes together, and they all roll up into the summary above.
          </p>
          <div className="form-row">
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Red Barn Ranch"
                required
              />
            </label>
            <label>
              Type
              <EntityTypePicker value={entityType} onChange={setEntityType} />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add business'}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </div>
      </main>
    </div>
  )
}
