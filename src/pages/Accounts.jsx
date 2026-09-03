import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, todayISO } from '../lib/money'

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking', group: 'Asset' },
  { value: 'savings', label: 'Savings', group: 'Asset' },
  { value: 'cash', label: 'Cash on hand', group: 'Asset' },
  { value: 'venmo', label: 'Venmo / other digital wallet', group: 'Asset' },
  { value: 'other_asset', label: 'Other asset', group: 'Asset' },
  { value: 'credit_card', label: 'Credit card', group: 'Liability' },
  { value: 'loan', label: 'Loan / mortgage', group: 'Liability' },
  { value: 'other_liability', label: 'Other liability', group: 'Liability' },
]

export default function Accounts() {
  const { entityId } = useOutletContext()
  const [accounts, setAccounts] = useState(null)
  const [name, setName] = useState('')
  const [accountType, setAccountType] = useState('checking')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [openingDate, setOpeningDate] = useState(todayISO())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadAccounts() {
    const { data, error } = await supabase
      .from('account_balances')
      .select('*')
      .eq('entity_id', entityId)
      .eq('is_archived', false)
      .order('name')
    if (error) setError(error.message)
    else setAccounts(data)
  }

  useEffect(() => {
    loadAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('financial_accounts').insert({
      entity_id: entityId,
      name: name.trim(),
      account_type: accountType,
      opening_balance: Number(openingBalance) || 0,
      opening_balance_date: openingDate,
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    setOpeningBalance('0')
    loadAccounts()
  }

  async function handleArchive(id) {
    if (!confirm('Archive this account? It will be hidden but past transactions stay intact.')) return
    await supabase.from('financial_accounts').update({ is_archived: true }).eq('id', id)
    loadAccounts()
  }

  return (
    <div className="page">
      <h1>Accounts</h1>
      <p className="page-subtitle">
        Every place money can sit or be owed for this business — a checking account, a cash box, Venmo, or a
        credit card. These balances are what your Money page&apos;s &quot;What it&apos;s worth&quot; number is
        built from.
      </p>

      {accounts === null && <p>Loading…</p>}

      {accounts && (
        <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th className="num">Balance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.financial_account_id}>
                <td>{a.name}</td>
                <td>{ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label ?? a.account_type}</td>
                <td className="num">{formatMoney(a.balance)}</td>
                <td>
                  <button className="link-button" onClick={() => handleArchive(a.financial_account_id)}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  No accounts yet — add your checking account below to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      <form className="inline-form" onSubmit={handleCreate}>
        <h2>Add an account</h2>
        <p className="page-subtitle">
          <strong>Asset</strong> is money you have — checking, savings, cash, Venmo.{' '}
          <strong>Liability</strong> is money you owe — a credit card balance or a loan. Both matter: what
          this business is worth is what it has minus what it owes.
        </p>
        <div className="form-row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase Checking" required />
          </label>
          <label>
            Type
            <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.group}: {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opening balance
            <input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </label>
          <label>
            As of
            <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add account'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  )
}
