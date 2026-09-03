import { useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/money'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// What the checkout kiosk (mbm-checkout) sells and what it charges - the
// same `products` table it reads from (public-products.mjs) and writes to
// (admin-products.mjs) when the kiosk's own /catalog page is used. This is
// that same data, managed from inside Farmgirl Finance instead, with a
// camera-scan shortcut for adding a product from your phone. Direct
// Supabase calls here (not through admin-products.mjs) since this page
// already has the owner's own session - RLS on `products` (migration
// 0005) is what actually enforces the entity-ownership check.
export default function Inventory() {
  const { entityId } = useOutletContext()
  const [products, setProducts] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [category, setCategory] = useState('')
  const [variantGroup, setVariantGroup] = useState('')
  const [variantLabel, setVariantLabel] = useState('')
  const [keywords, setKeywords] = useState('')

  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState('')
  const fileInputRef = useRef(null)

  async function loadProducts() {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('entity_id', entityId)
      .eq('is_archived', false)
      .order('name')
    if (error) setError(error.message)
    else setProducts(data)
  }

  useEffect(() => {
    loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  function resetForm() {
    setName('')
    setPrice('')
    setCost('')
    setCategory('')
    setVariantGroup('')
    setVariantLabel('')
    setKeywords('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || price === '' || Number(price) < 0) {
      setError('A name and a price of zero or more are required.')
      return
    }
    setBusy(true)
    setError('')
    const { error } = await supabase.from('products').insert({
      entity_id: entityId,
      name: name.trim(),
      price: Number(price),
      cost: cost === '' ? null : Number(cost),
      category: category.trim() || null,
      variant_group: variantGroup.trim() || null,
      variant_label: variantLabel.trim() || null,
      keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    resetForm()
    setScanNote('')
    loadProducts()
  }

  async function handleArchive(id) {
    if (!confirm('Archive this product? It stops showing at checkout, but you can bring it back anytime.')) return
    await supabase.from('products').update({ is_archived: true }).eq('id', id)
    loadProducts()
  }

  async function handleScan(e) {
    const selected = e.target.files?.[0]
    if (!selected) return
    setScanning(true)
    setScanNote('')
    setError('')
    try {
      const base64 = await fileToBase64(selected)
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch('/.netlify/functions/scan-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: base64, mimeType: selected.type }),
      })
      if (!res.ok) throw new Error('scan failed')
      const extracted = await res.json()
      if (extracted.name) setName(extracted.name)
      if (extracted.price) setPrice(String(extracted.price))
      if (extracted.category_hint) setCategory(extracted.category_hint)
      setScanNote(
        extracted.name || extracted.price
          ? 'Filled in from the photo — double-check before saving.'
          : "Couldn't make out a name or price in that photo — fill in the details below."
      )
    } catch {
      setScanNote("Couldn't read that automatically — fill in the details below.")
    } finally {
      setScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="page">
      <h1>Inventory</h1>
      <p className="page-subtitle">
        What the checkout kiosk sells and what it charges. Hold a product up to your phone&apos;s
        camera to fill in the name and price automatically, or just type them in below.
      </p>

      <label className="btn-primary scan-product-btn">
        📷 Scan a product to add it
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScan}
          className="visually-hidden-input"
        />
      </label>
      {scanning && <p className="form-info">Reading photo…</p>}
      {!scanning && scanNote && <p className="form-info">{scanNote}</p>}

      {products === null && <p>Loading…</p>}

      {products && (
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Group / size</th>
              <th className="num">Price</th>
              <th className="num">Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.category || '—'}</td>
                <td>{p.variant_group ? `${p.variant_group}${p.variant_label ? ' (' + p.variant_label + ')' : ''}` : '—'}</td>
                <td className="num">{formatMoney(p.price)}</td>
                <td className="num">{p.cost != null ? formatMoney(p.cost) : '—'}</td>
                <td>
                  <button
                    className="header-btn header-btn--sm header-btn--danger"
                    onClick={() => handleArchive(p.id)}
                  >
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  Nothing yet — scan or add your first product below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      <form className="inline-form" onSubmit={handleSubmit}>
        <h2>Add a product</h2>
        <p className="page-subtitle">
          Anything you add here is something the checkout can recognize and ring up. Name and price
          are all it needs — cost is optional, and it&apos;s what lets you see profit per item later.
        </p>
        <div className="form-row">
          <label className="grow">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Buckwheat Honey — 12oz" required />
          </label>
          <label>
            Price
            <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" required />
          </label>
          <label>
            Your cost (optional)
            <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="What you paid" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Category (optional)
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Honey, Eggs, Produce" />
          </label>
          <label>
            Product group (optional)
            <input value={variantGroup} onChange={(e) => setVariantGroup(e.target.value)} placeholder="e.g. Buckwheat Honey — same for every size" />
          </label>
          <label>
            Size / variant (optional)
            <input value={variantLabel} onChange={(e) => setVariantLabel(e.target.value)} placeholder="e.g. 12oz" />
          </label>
        </div>
        <div className="form-row">
          <label className="grow">
            Keywords (optional, comma separated)
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. honey, raw honey — other words a customer might say" />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add product'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  )
}
