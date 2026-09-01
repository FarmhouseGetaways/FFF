import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext.jsx'

const ENTITY_TYPES = [
  { value: 'property', label: 'Rental Property' },
  { value: 'farmstand', label: 'Farmstand' },
  { value: 'other', label: 'Other' },
]

export default function EntityPicker() {
  const { signOut } = useAuth()
  const [entities, setEntities] = useState(null)
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('property')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadEntities() {
    const { data, error } = await supabase
      .from('entities')
      .select('id, name, entity_type')
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

  return (
    <div className="page">
      <header className="page-header">
        <h1>Your Entities</h1>
        <button className="link-button" onClick={signOut}>
          Sign out
        </button>
      </header>

      {entities === null && <p>Loading…</p>}

      {entities && entities.length === 0 && (
        <p className="empty-state">No entities yet — add your first property or farmstand below.</p>
      )}

      <ul className="entity-list">
        {entities?.map((entity) => (
          <li key={entity.id}>
            <Link to={`/entities/${entity.id}`} className="entity-card">
              <span className="entity-name">{entity.name}</span>
              <span className="entity-type">{entity.entity_type}</span>
            </Link>
          </li>
        ))}
      </ul>

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
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add entity'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  )
}
