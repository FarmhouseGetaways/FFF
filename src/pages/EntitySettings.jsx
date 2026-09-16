import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import EntityTypePicker from '../components/EntityTypePicker.jsx'
import NotificationToggle from '../components/NotificationToggle.jsx'

/**
 * "Order another POS" - a request, not a self-serve provision (Cory, 8 Sep
 * 2026: "Request only, you follow up"). A stand is real hardware that has to
 * be shipped and a merchant account that has to be applied for, so nothing
 * here should look instant. Submitting files a row (pos_requests) and pushes
 * every admin - see pos-request.mjs for both. `locationName` is asked for
 * here on purpose: this is the one moment the customer actually knows what
 * to call their new stand, and it is what tells two stands on one business
 * apart everywhere else (the pos-enter picker included).
 */
function OrderPosForm({ entityId }) {
  const [open, setOpen] = useState(false)
  const [locationName, setLocationName] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!locationName.trim()) return
    setBusy(true)
    setError('')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/.netlify/functions/pos-request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          locationName: locationName.trim(),
          shippingAddress: shippingAddress.trim(),
          notes: notes.trim(),
        }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
      setSent(true)
      setOpen(false)
      setLocationName('')
      setShippingAddress('')
      setNotes('')
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (sent) {
    return (
      <p className="form-info">
        Request sent. We&apos;ll follow up about payment and shipping directly.
      </p>
    )
  }

  if (!open) {
    return (
      <div className="page-actions">
        <button className="header-btn" onClick={() => setOpen(true)}>
          Order another POS
        </button>
      </div>
    )
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <div className="form-row">
        <label>
          What should this stand be called?
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. North Lot"
            required
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Shipping address for the reader
          <textarea
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            rows={2}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Anything else we should know?
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
      </div>
      <div className="page-actions">
        <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
        <button type="button" className="header-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}

// A logo is shown at 40-96px across the app, so a 4MB photo off a phone is
// megabytes nobody sees. Redrawn through a canvas before it goes up; if the
// browser can't decode it (an SVG, mostly), the original file is uploaded.
const MAX_SIDE = 512
async function shrink(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 200_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ?? file
  } catch {
    return file
  }
}

export default function EntitySettings() {
  const { entityId, onEntityUpdated } = useOutletContext()
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('property')
  const [logoUrl, setLogoUrl] = useState(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState('')
  const logoInput = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    supabase
      .from('entities')
      .select('name, entity_type, logo_url')
      .eq('id', entityId)
      .single()
      .then(({ data }) => {
        if (!active || !data) return
        setName(data.name)
        setEntityType(data.entity_type)
        setLogoUrl(data.logo_url)
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
    onEntityUpdated?.({ id: entityId, name: name.trim(), entity_type: entityType, logo_url: logoUrl })
    setSaved(true)
  }

  async function handleLogo(e) {
    const file = e.target.files?.[0]
    if (logoInput.current) logoInput.current.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setLogoError('That needs to be an image file.')
      return
    }
    if (file.size > 10_000_000) {
      setLogoError('That image is too big — 10MB is the limit.')
      return
    }
    setLogoBusy(true)
    setLogoError('')
    const blob = await shrink(file)
    const ext = blob.type === 'image/png' ? 'png' : (file.name.split('.').pop() || 'png').toLowerCase()
    // A new filename each time: the old URL is cached hard by the CDN, and
    // a logo that takes a day to change is a logo that looks broken.
    const path = `${entityId}/logo-${Date.now()}.${ext}`
    const up = await supabase.storage.from('entity-logos').upload(path, blob, {
      contentType: blob.type || file.type,
      upsert: true,
    })
    if (up.error) {
      setLogoBusy(false)
      setLogoError(up.error.message)
      return
    }
    const { data: pub } = supabase.storage.from('entity-logos').getPublicUrl(path)
    const { error } = await supabase.from('entities').update({ logo_url: pub.publicUrl }).eq('id', entityId)
    if (error) {
      setLogoBusy(false)
      setLogoError(error.message)
      return
    }
    setLogoUrl(pub.publicUrl)
    onEntityUpdated?.({ id: entityId, name: name.trim(), entity_type: entityType, logo_url: pub.publicUrl })
    // Whatever was there before is now unreachable - don't leave it paid for.
    const { data: existing } = await supabase.storage.from('entity-logos').list(entityId)
    const stale = (existing ?? []).map((f) => `${entityId}/${f.name}`).filter((p) => p !== path)
    if (stale.length) await supabase.storage.from('entity-logos').remove(stale)
    setLogoBusy(false)
  }

  async function handleRemoveLogo() {
    setLogoBusy(true)
    setLogoError('')
    const { error } = await supabase.from('entities').update({ logo_url: null }).eq('id', entityId)
    if (error) {
      setLogoBusy(false)
      setLogoError(error.message)
      return
    }
    const { data: existing } = await supabase.storage.from('entity-logos').list(entityId)
    const all = (existing ?? []).map((f) => `${entityId}/${f.name}`)
    if (all.length) await supabase.storage.from('entity-logos').remove(all)
    setLogoUrl(null)
    onEntityUpdated?.({ id: entityId, name: name.trim(), entity_type: entityType, logo_url: null })
    setLogoBusy(false)
  }

  if (!loaded) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="page-subtitle">Rename this business or change what kind it is.</p>

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
        <h2>Logo</h2>
        <p className="page-subtitle">
          Shown beside this business&apos;s name everywhere in the app, so there&apos;s never a question
          which one you&apos;re looking at.
        </p>
        <div className="logo-setting">
          <div className="logo-preview">
            {logoUrl ? <img src={logoUrl} alt={`${name} logo`} /> : <span>No logo yet</span>}
          </div>
          <div className="logo-actions">
            <label className="header-btn">
              {logoBusy ? 'Working…' : logoUrl ? 'Replace logo' : 'Upload a logo'}
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                onChange={handleLogo}
                disabled={logoBusy}
                className="visually-hidden-input"
              />
            </label>
            {logoUrl && (
              <button
                type="button"
                className="header-btn header-btn--danger"
                onClick={handleRemoveLogo}
                disabled={logoBusy}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {logoError && <p className="form-error">{logoError}</p>}
      </section>

      <section className="settings-section">
        <h2>Notifications</h2>
        <p className="page-subtitle">
          Turn this on and the stand can reach you: when it drops off the internet,
          when somebody stands there with shopping and can&apos;t pay, and when it
          sells something the catalog has never heard of. All three need a person,
          and none of them can wait for you to next open the app.
        </p>
        <p className="page-subtitle">
          It applies to this device only &mdash; a phone and a laptop each have to
          say yes. On an iPhone, add this to the Home Screen first.
        </p>
        <NotificationToggle />
      </section>

      <section className="settings-section">
        <h2>Checkout stand</h2>
        <p className="page-subtitle">
          Running more than one location? Order another checkout stand for this business &mdash;
          we&apos;ll follow up about payment and shipping.
        </p>
        <OrderPosForm entityId={entityId} />
      </section>

      <section className="settings-section">
        <h2>Categories</h2>
        <p className="page-subtitle">
          The income and expense buckets this business&apos;s transactions get sorted into. Set them up once;
          they&apos;re what breaks the Money page down by category instead of one big number.
        </p>
        <div className="page-actions">
          <Link to="../categories" className="header-btn">
            Manage categories →
          </Link>
        </div>
      </section>
    </div>
  )
}
