import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, todayISO } from '../lib/money'
import { guessCategory } from '../lib/csvImport'

const SOURCE_LABELS = {
  manual: 'Manual',
  csv_import: 'CSV import',
  venmo_csv: 'Venmo CSV',
  plaid: 'Bank sync',
}

async function uploadAttachment(entityId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${entityId}/${crypto.randomUUID()}-${safeName}`
  const { error } = await supabase.storage.from('transaction-attachments').upload(path, file)
  if (error) throw error
  return path
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function Transactions() {
  const { entityId } = useOutletContext()
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [transactions, setTransactions] = useState(null)
  const [lookupsLoaded, setLookupsLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [kind, setKind] = useState('expense') // 'income' | 'expense' | 'transfer'
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [file, setFile] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState('')
  const fileInputRef = useRef(null)

  async function loadLookups() {
    const [{ data: accts }, { data: cats }] = await Promise.all([
      supabase
        .from('financial_accounts')
        .select('id, name, account_type')
        .eq('entity_id', entityId)
        .eq('is_archived', false)
        .order('name'),
      supabase
        .from('categories')
        .select('id, name, category_type')
        .eq('entity_id', entityId)
        .eq('is_archived', false)
        .order('name'),
    ])
    setAccounts(accts ?? [])
    setCategories(cats ?? [])
    setLookupsLoaded(true)
  }

  async function loadTransactions() {
    const { data, error } = await supabase
      .from('transactions')
      .select(
        `id, txn_date, description, amount, source, transfer_group_id, attachment_path,
         financial_account:financial_accounts(name),
         category:categories(name, category_type)`
      )
      .eq('entity_id', entityId)
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) setError(error.message)
    else setTransactions(data)
  }

  useEffect(() => {
    loadLookups()
    loadTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.category_type === kind),
    [categories, kind]
  )

  useEffect(() => {
    setCategoryId('')
  }, [kind])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const numericAmount = Number(amount)
    if (!numericAmount || numericAmount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (!accountId) {
      setError('Choose an account.')
      return
    }
    setBusy(true)

    try {
      if (kind === 'transfer') {
        if (!toAccountId || toAccountId === accountId) {
          setError('Choose a different destination account for the transfer.')
          return
        }
        const transferGroupId = crypto.randomUUID()
        const { error } = await supabase.from('transactions').insert([
          {
            entity_id: entityId,
            financial_account_id: accountId,
            txn_date: date,
            description: description || 'Transfer',
            amount: -numericAmount,
            transfer_group_id: transferGroupId,
          },
          {
            entity_id: entityId,
            financial_account_id: toAccountId,
            txn_date: date,
            description: description || 'Transfer',
            amount: numericAmount,
            transfer_group_id: transferGroupId,
          },
        ])
        if (error) throw error
      } else {
        if (!categoryId) {
          setError('Choose a category.')
          return
        }
        const attachmentPath = file ? await uploadAttachment(entityId, file) : null
        const { error } = await supabase.from('transactions').insert({
          entity_id: entityId,
          financial_account_id: accountId,
          category_id: categoryId,
          txn_date: date,
          description,
          amount: kind === 'income' ? numericAmount : -numericAmount,
          attachment_path: attachmentPath,
        })
        if (error) throw error
      }

      setDescription('')
      setAmount('')
      setFile(null)
      setScanNote('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      loadTransactions()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleFileChange(e) {
    const selected = e.target.files?.[0] ?? null
    setFile(selected)
    setScanNote('')
    if (!selected || !selected.type.startsWith('image/')) return

    setScanning(true)
    try {
      const base64 = await fileToBase64(selected)
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch('/.netlify/functions/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: base64, mimeType: selected.type }),
      })
      if (!res.ok) throw new Error('scan failed')
      const extracted = await res.json()

      if (extracted.date) setDate(extracted.date)
      if (extracted.total) setAmount(String(extracted.total))
      if (extracted.merchant) setDescription(extracted.merchant)
      if (extracted.category_hint) {
        const guessedId = guessCategory(extracted.category_hint, categories, kind === 'income' ? 'income' : 'expense')
        if (guessedId) setCategoryId(guessedId)
      }
      setScanNote('Filled in from the receipt — double-check before saving.')
    } catch {
      setScanNote("Couldn't read the receipt automatically — fill in the details below.")
    } finally {
      setScanning(false)
    }
  }

  async function handleDelete(txn) {
    if (!confirm('Delete this transaction?')) return
    if (txn.transfer_group_id) {
      await supabase.from('transactions').delete().eq('transfer_group_id', txn.transfer_group_id)
    } else {
      await supabase.from('transactions').delete().eq('id', txn.id)
    }
    loadTransactions()
  }

  async function handleViewAttachment(path) {
    const { data, error } = await supabase.storage
      .from('transaction-attachments')
      .createSignedUrl(path, 60)
    if (error) {
      setError(error.message)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div className="page">
      <h1>Transactions</h1>

      {/* Every transaction has to land in an account, and a brand-new entity
          has none - without this the form just renders an empty dropdown and
          refuses to submit, with nothing telling you why. */}
      {lookupsLoaded && accounts.length === 0 && (
        <div className="setup-callout">
          <h2>Add an account first</h2>
          <p>
            Every transaction has to land somewhere — a checking account, a cash box, Venmo,
            a credit card. Add at least one and this form will be ready to use.
          </p>
          <Link to="../accounts" className="btn-primary">
            Add an account
          </Link>
        </div>
      )}

      {lookupsLoaded && accounts.length > 0 && (
      <form className="txn-form" onSubmit={handleSubmit}>
        <div className="kind-toggle">
          {['expense', 'income', 'transfer'].map((k) => (
            <button
              type="button"
              key={k}
              className={'kind-btn' + (kind === k ? ' active' : '')}
              onClick={() => setKind(k)}
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        <div className="form-row">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>

          <label>
            {kind === 'transfer' ? 'From account' : 'Account'}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="" disabled>
                Select…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          {kind === 'transfer' ? (
            <label>
              To account
              <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
                <option value="" disabled>
                  Select…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="" disabled>
                  Select…
                </option>
                {filteredCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Amount
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </label>

          <label className="grow">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </label>

          {kind !== 'transfer' && (
            <label>
              Receipt
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileChange}
              />
            </label>
          )}

          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
        {scanning && <p className="form-info">Reading receipt…</p>}
        {!scanning && scanNote && <p className="form-info">{scanNote}</p>}
        {error && <p className="form-error">{error}</p>}
      </form>
      )}

      {transactions === null && <p>Loading…</p>}

      {transactions && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Account</th>
              <th>Category</th>
              <th>Description</th>
              <th>Source</th>
              <th className="num">Amount</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              // Money in and money out get different row shading, not just a
              // minus sign - the sign alone is easy to miss when scanning.
              // Transfers are neither, so they stay neutral.
              <tr
                key={t.id}
                className={
                  !t.category ? 'row-transfer' : t.amount < 0 ? 'row-out' : 'row-in'
                }
              >
                <td>{t.txn_date}</td>
                <td>{t.financial_account?.name}</td>
                <td>{t.category ? t.category.name : 'Transfer'}</td>
                <td>{t.description}</td>
                <td>{SOURCE_LABELS[t.source] ?? t.source}</td>
                <td className={'num' + (t.amount < 0 ? ' negative' : ' positive')}>
                  {formatMoney(t.amount)}
                </td>
                <td>
                  {t.attachment_path && (
                    <button className="link-button" onClick={() => handleViewAttachment(t.attachment_path)}>
                      Receipt
                    </button>
                  )}
                </td>
                <td>
                  <button className="link-button" onClick={() => handleDelete(t)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-state">
                  No transactions yet — add your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
