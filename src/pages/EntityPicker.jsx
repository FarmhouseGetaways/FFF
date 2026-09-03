import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext.jsx'
import { useIsAdmin } from '../lib/useIsAdmin.js'
import { labelForType } from '../lib/entityTypes'
import EntityTypePicker from '../components/EntityTypePicker.jsx'

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

export default function EntityPicker() {
  const { signOut } = useAuth()
  const { isAdmin } = useIsAdmin()
  const [entities, setEntities] = useState(null)
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('property')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  async function loadEntities() {
    const { data, error } = await supabase
      .from('entities')
      .select('id, name, entity_type, is_archived')
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

  async function setArchived(id, archived) {
    setBusy(true)
    await supabase.from('entities').update({ is_archived: archived }).eq('id', id)
    await loadEntities()
    setBusy(false)
  }

  const visibleEntities = entities ? entities.filter((e) => (showArchived ? e.is_archived : !e.is_archived)) : null

  return (
    <div className="page">
      <header className="page-header">
        <h1>Your Entities</h1>
        <div>
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

      <ul className="entity-list">
        {visibleEntities?.map((entity) => (
          <li key={entity.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {showArchived ? (
              <div className="entity-card" style={{ flex: 1 }}>
                <span className="entity-name">{entity.name}</span>
                <span className="entity-type">{labelForType(entity.entity_type)}</span>
              </div>
            ) : (
              <Link to={`/entities/${entity.id}`} className="entity-card" style={{ flex: 1 }}>
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
              <button className="link-button" disabled={busy} onClick={() => setArchived(entity.id, true)}>
                Archive
              </button>
            )}
          </li>
        ))}
      </ul>

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
