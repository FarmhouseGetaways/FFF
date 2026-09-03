import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext.jsx'
import { useIsAdmin } from '../lib/useIsAdmin.js'
import { labelForType, BUILT_IN_TYPES } from '../lib/entityTypes'
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
  const { signOut } = useAuth()
  const { isAdmin } = useIsAdmin()
  const [entities, setEntities] = useState(null)
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('property')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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

  async function setArchived(id, archived, name) {
    if (archived && !window.confirm(`Archive ${name}? It'll drop off this list, but you can reinstate it anytime from "View archived entities."`)) {
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

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="brand-lockup">
          <Logo size={32} />
          Farmgirl Finance
        </h1>
        <div>
          <Link to="/" className="link-button" style={{ marginRight: '1rem' }}>
            ← Back to home
          </Link>
          {isAdmin && (
            <Link to="/admin" className="link-button" style={{ marginRight: '1rem' }}>
              Admin
            </Link>
          )}
          <button className="link-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {!showArchived && <HomeSummary />}

      <h2 className="section-title">Your Entities</h2>
      <p className="page-subtitle">These are the businesses that are earning you money.</p>

      <p>
        <button className="link-button" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? '← Back to active entities' : 'View archived entities'}
        </button>
        {!showArchived && visibleEntities && visibleEntities.length > 0 && (
          <button
            className="link-button"
            style={{ marginLeft: '1rem' }}
            onClick={() => downloadCsv('entities.csv', visibleEntities)}
          >
            Download CSV
          </button>
        )}
      </p>

      {error && <p className="form-error">{error}</p>}
      {visibleEntities === null && <p>Loading…</p>}

      {visibleEntities && visibleEntities.length === 0 && (
        <p className="empty-state">
          {showArchived ? 'No archived entities.' : 'No entities yet — add your first property or farmstand below.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.type} style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.9rem', color: 'var(--muted, #888)', margin: '0 0 0.5rem' }}>{group.label}</h2>
          <ul className="entity-list">
            {group.items.map((entity) => (
              <li
                key={entity.id}
                draggable={!showArchived}
                onDragStart={() => setDragId(entity.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(group.items, entity.id)}
                onDragEnd={() => setDragId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  opacity: dragId === entity.id ? 0.5 : 1,
                  cursor: showArchived ? 'default' : 'grab',
                }}
              >
                {!showArchived && (
                  <span aria-hidden="true" style={{ color: 'var(--muted, #888)', userSelect: 'none' }}>
                    ⠿
                  </span>
                )}
                {showArchived ? (
                  <div className="entity-card" style={{ flex: 1 }}>
                    <span className="entity-name">{entity.name}</span>
                    <span className="entity-type">{labelForType(entity.entity_type)}</span>
                  </div>
                ) : (
                  <Link to={`/entities/${entity.id}`} className="entity-card" draggable={false} style={{ flex: 1 }}>
                    <span className="entity-name">{entity.name}</span>
                    <span className="entity-type">{labelForType(entity.entity_type)}</span>
                  </Link>
                )}
                {showArchived ? (
                  <>
                    <button
                      className="link-button"
                      disabled={busy}
                      onClick={() => downloadCsv(`${entity.name}.csv`, [entity])}
                    >
                      Download
                    </button>
                    <button className="link-button" disabled={busy} onClick={() => setArchived(entity.id, false)}>
                      Reinstate
                    </button>
                  </>
                ) : (
                  <button className="link-button" disabled={busy} onClick={() => setArchived(entity.id, true, entity.name)}>
                    Archive
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {!showArchived && (
        <form className="inline-form" onSubmit={handleCreate}>
          <h2>Add an entity</h2>
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
              {busy ? 'Adding…' : 'Add entity'}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </div>
  )
}
