import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import EntityTypePicker from '../components/EntityTypePicker.jsx'

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
            <EntityTypePicker value={entityType} onChange={setEntityType} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-info">Saved.</p>}
      </form>

      <section className="settings-section">
        <h2>Categories</h2>
        <p className="page-subtitle">
          The income and expense buckets this entity's transactions get sorted into. Set them up
          once; they drive your Profit &amp; Loss.
        </p>
        <Link to="../categories" className="link-button">
          Manage categories →
        </Link>
      </section>
    </div>
  )
}
