import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const ENTITY_TYPES = [
  { value: 'property', label: 'Rental Property' },
  { value: 'farmstand', label: 'Farmstand' },
  { value: 'other', label: 'Other' },
]

export default function EntitySettings() {
  const { entityId, onEntityUpdated } = useOutletContext()
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('property')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    supabase
      .from('entities')
      .select('name, entity_type')
      .eq('id', entityId)
      .single()
      .then(({ data }) => {
        if (!active || !data) return
        setName(data.name)
        setEntityType(data.entity_type)
        setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [entityId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    setSaved(false)
    const { error } = await supabase
      .from('entities')
      .update({ name: name.trim(), entity_type: entityType })
      .eq('id', entityId)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    onEntityUpdated?.({ id: entityId, name: name.trim(), entity_type: entityType })
    setSaved(true)
  }

  if (!loaded) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="page-subtitle">Rename this entity or change its type.</p>

      <form className="inline-form" onSubmit={handleSubmit} style={{ marginTop: '1.5rem' }}>
        <div className="form-row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
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
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-info">Saved.</p>}
      </form>
    </div>
  )
}
