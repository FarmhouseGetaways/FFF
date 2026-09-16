import { useEffect, useMemo, useRef, useState } from 'react'
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

// Selling price over wholesale, as dollars and percent of wholesale. Blank
// when there's no wholesale price to measure against.
function markup(p) {
  const cost = p.cost == null ? null : Number(p.cost)
  if (!cost) return null
  const each = Number(p.price) - cost
  return { each, pct: Math.round((each / cost) * 100) }
}

// What the checkout kiosk (mbm-checkout) sells and what it charges - the
// same `products` table it reads from (public-products.mjs) and writes to
// (admin-products.mjs) when the kiosk's own /catalog page is used. This is
// that same data, managed from inside Farmgirl Finance instead, with a
// camera-scan shortcut for adding a product from your phone. Direct
// Supabase calls here (not through admin-products.mjs) since this page
// already has the owner's own session - RLS on `products` (migration
// 0005) is what actually enforces the entity-ownership check.
//
// Vendor, and markup from the wholesale (`cost`) and selling price, added
// 14 Sep 2026 so this doubles as the vendor price list a tester kept in a
// spreadsheet (migration 0011). Edit came with it - vendor and wholesale
// have to be fillable on products that already exist.
export default function Inventory() {
  const { entityId } = useOutletContext()
  const [products, setProducts] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [vendorFilter, setVendorFilter] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [category, setCategory] = useState('')
  const [variantGroup, setVariantGroup] = useState('')
  const [variantLabel, setVariantLabel] = useState('')
  const [keywords, setKeywords] = useState('')
  const [orderedQty, setOrderedQty] = useState('')
  const [paid, setPaid] = useState(false)

  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState('')
  const fileInputRef = useRef(null)
  const formRef = useRef(null)

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

  const vendors = useMemo(
    () => [...new Set((products ?? []).map((p) => p.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products]
  )

  const shown = useMemo(() => {
    const list = (products ?? []).filter((p) => !vendorFilter || p.vendor === vendorFilter)
    // Grouped by vendor, the way a price list reads; no vendor last.
    return list.sort(
      (a, b) =>
        (a.vendor ? 0 : 1) - (b.vendor ? 0 : 1) ||
        (a.vendor || '').localeCompare(b.vendor || '') ||
        a.name.localeCompare(b.name)
    )
  }, [products, vendorFilter])

  // What the orders still marked unpaid come to, at wholesale.
  const owed = useMemo(() => {
    const rows = shown.filter((p) => !p.paid && Number(p.ordered_qty) > 0 && p.cost != null)
    return { count: rows.length, total: rows.reduce((s, p) => s + Number(p.ordered_qty) * Number(p.cost), 0) }
  }, [shown])

  function resetForm() {
    setEditingId(null)
    setName('')
    setVendor('')
    setPrice('')
    setCost('')
    setCategory('')
    setVariantGroup('')
    setVariantLabel('')
    setKeywords('')
    setOrderedQty('')
    setPaid(false)
  }

  function startEdit(p) {
    setEditingId(p.id)
    setName(p.name)
    setVendor(p.vendor || '')
    setPrice(String(p.price))
    setCost(p.cost != null ? String(p.cost) : '')
    setCategory(p.category || '')
    setVariantGroup(p.variant_group || '')
    setVariantLabel(p.variant_label || '')
    setKeywords((p.keywords || []).join(', '))
    setOrderedQty(p.ordered_qty != null ? String(p.ordered_qty) : '')
    setPaid(!!p.paid)
    setError('')
    setScanNote('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || price === '' || Number(price) < 0) {
      setError('A name and a price of zero or more are required.')
      return
    }
    setBusy(true)
    setError('')
    const fields = {
      name: name.trim(),
      vendor: vendor.trim() || null,
      price: Number(price),
      cost: cost === '' ? null : Number(cost),
      category: category.trim() || null,
      variant_group: variantGroup.trim() || null,
      variant_label: variantLabel.trim() || null,
      keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
      ordered_qty: orderedQty === '' ? null : Number(orderedQty),
      paid,
    }
    const { error } = editingId
      ? await supabase
          .from('products')
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq('id', editingId)
      : await supabase.from('products').insert({ entity_id: entityId, ...fields })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    resetForm()
    setScanNote('')
    loadProducts()
  }

  // Paid flips straight from the row - marking off a vendor bill shouldn't
  // mean opening the edit form. Updated in place so the list doesn't jump.
  async function togglePaid(p) {
    const next = !p.paid
    setProducts((list) => list.map((row) => (row.id === p.id ? { ...row, paid: next } : row)))
    const { error } = await supabase
      .from('products')
      .update({ paid: next, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    if (error) {
      setError(error.message)
      setProducts((list) => list.map((row) => (row.id === p.id ? { ...row, paid: p.paid } : row)))
    }
  }

  async function handleArchive(id) {
    if (!confirm('Archive this product? It stops showing at checkout, but you can bring it back anytime.')) return
    await supabase.from('products').update({ is_archived: true }).eq('id', id)
    if (editingId === id) resetForm()
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
    <div className="page page--wide">
      <h1>Inventory</h1>
      <p className="page-subtitle">
        What you sell, who you buy it from, and what you pay and charge for it. Hold a product up to
        your phone&apos;s camera to fill in the name and price automatically, or type them in below.
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

      {products && vendors.length > 0 && (
        <div className="date-range">
          <label>
            Vendor
            <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {products && (
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Vendor</th>
              <th>Category</th>
              <th>Group / size</th>
              <th className="num">Ordered</th>
              <th>Paid</th>
              <th className="num">Wholesale</th>
              <th className="num">Selling price</th>
              <th className="num">Markup</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const m = markup(p)
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.vendor || '—'}</td>
                  <td>{p.category || '—'}</td>
                  <td>{p.variant_group ? `${p.variant_group}${p.variant_label ? ' (' + p.variant_label + ')' : ''}` : '—'}</td>
                  <td className="num">{p.ordered_qty != null ? p.ordered_qty : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className={'paid-pill' + (p.paid ? ' is-paid' : '')}
                      onClick={() => togglePaid(p)}
                      aria-pressed={p.paid}
                    >
                      {p.paid
                        ? 'Paid'
                        : p.ordered_qty != null && p.cost != null
                          ? `Owe ${formatMoney(Number(p.ordered_qty) * Number(p.cost))}`
                          : 'Not paid'}
                    </button>
                  </td>
                  <td className="num">{p.cost != null ? formatMoney(p.cost) : '—'}</td>
                  <td className="num">{formatMoney(p.price)}</td>
                  <td className={'num' + (m && m.each < 0 ? ' negative' : '')}>
                    {m ? `${formatMoney(m.each)} (${m.pct}%)` : '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="header-btn header-btn--sm" onClick={() => startEdit(p)}>
                        Edit
                      </button>
                      <button
                        className="header-btn header-btn--sm header-btn--danger"
                        onClick={() => handleArchive(p.id)}
                      >
                        Archive
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-state">
                  Nothing yet — scan or add your first product below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {products && owed.count > 0 && (
        <p className="form-notice">
          Still to pay: {formatMoney(owed.total)} across {owed.count} item{owed.count === 1 ? '' : 's'} on order.
          Tap a Paid button to mark one off.
        </p>
      )}

      <form className="inline-form" onSubmit={handleSubmit} ref={formRef}>
        <h2>{editingId ? 'Edit product' : 'Add a product'}</h2>
        <p className="page-subtitle">
          Anything you add here is something the checkout can recognize and ring up. Name and selling
          price are all it needs. Add the wholesale price to see your markup.
        </p>
        <div className="form-row">
          <label className="grow">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mini loaf" required />
          </label>
          <label>
            Vendor (optional)
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. East County Dough"
              list="inventory-vendors"
            />
          </label>
          <datalist id="inventory-vendors">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <div className="form-row">
          <label>
            Wholesale price (optional)
            <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="What you pay" />
          </label>
          <label>
            Selling price
            <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" required />
          </label>
          <label>
            Category (optional)
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Baked goods, Honey, Eggs" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Ordered (optional)
            <input
              type="number"
              step="1"
              min="0"
              value={orderedQty}
              onChange={(e) => setOrderedQty(e.target.value)}
              placeholder="How many you have on order"
            />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            Paid for this order
          </label>
        </div>
        <div className="form-row">
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
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add product'}
          </button>
          {editingId && (
            <button type="button" className="header-btn" onClick={resetForm} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  )
}
