import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/money'

function startOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'other_liability'])

// Profit & Loss and Balance Sheet, combined into one page and led with
// plain language - Cory's read, 3 Sep 2026: "they seem to show related
// data, incoming and outgoing $ and then how much is in the account" was
// exactly right, and two separate sidebar destinations for that was
// confusing for someone who isn't an accountant. The four summary cards
// mirror the tone HomeSummary already uses on Your Entities; the detailed,
// accountant-shaped category/account tables are kept below (collapsed to
// the flow one by default) rather than removed - still useful, just not
// the first thing shown.
export default function Money() {
  const { entityId } = useOutletContext()
  const [from, setFrom] = useState(startOfMonth())
  const [to, setTo] = useState(today())
  const [txnRows, setTxnRows] = useState(null)
  const [balanceRows, setBalanceRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setTxnRows(null)
    supabase
      .from('transactions')
      .select('amount, category:categories(id, name, category_type)')
      .eq('entity_id', entityId)
      .not('category_id', 'is', null)
      .gte('txn_date', from)
      .lte('txn_date', to)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setTxnRows(data)
      })
    return () => {
      active = false
    }
  }, [entityId, from, to])

  useEffect(() => {
    let active = true
    setBalanceRows(null)
    supabase
      .from('account_balances')
      .select('*')
      .eq('entity_id', entityId)
      .eq('is_archived', false)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setBalanceRows(data)
      })
    return () => {
      active = false
    }
  }, [entityId])

  const { income, expense, totalIncome, totalExpense, netIncome } = useMemo(() => {
    const byCategory = new Map()
    for (const r of txnRows ?? []) {
      if (!r.category) continue
      const key = r.category.id
      const existing = byCategory.get(key) ?? { name: r.category.name, type: r.category.category_type, total: 0 }
      existing.total += Number(r.amount)
      byCategory.set(key, existing)
    }
    const all = [...byCategory.values()]
    const income = all.filter((c) => c.type === 'income').sort((a, b) => b.total - a.total)
    const expense = all
      .filter((c) => c.type === 'expense')
      .map((c) => ({ ...c, total: Math.abs(c.total) }))
      .sort((a, b) => b.total - a.total)
    const totalIncome = income.reduce((s, c) => s + c.total, 0)
    const totalExpense = expense.reduce((s, c) => s + c.total, 0)
    return { income, expense, totalIncome, totalExpense, netIncome: totalIncome - totalExpense }
  }, [txnRows])

  const { assets, liabilities, totalAssets, totalLiabilities, equity } = useMemo(() => {
    const assets = (balanceRows ?? []).filter((r) => !LIABILITY_TYPES.has(r.account_type))
    const liabilities = (balanceRows ?? []).filter((r) => LIABILITY_TYPES.has(r.account_type))
    const totalAssets = assets.reduce((s, r) => s + Number(r.balance), 0)
    const totalLiabilities = liabilities.reduce((s, r) => s + Number(r.balance), 0)
    return { assets, liabilities, totalAssets, totalLiabilities, equity: totalAssets - totalLiabilities }
  }, [balanceRows])

  const loading = txnRows === null || balanceRows === null

  const cards = [
    { label: 'Money in', value: totalIncome, note: 'Everything you took in during this range.', tone: 'in' },
    { label: 'Money out', value: totalExpense, note: 'Everything you spent during this range.', tone: 'out' },
    {
      label: 'Left over',
      value: netIncome,
      note: netIncome >= 0 ? 'What you kept. In is beating out.' : 'You spent more than you took in.',
      tone: netIncome >= 0 ? 'in' : 'out',
    },
    { label: "What it's worth", value: equity, note: 'What you own minus what you owe, right now.', tone: 'neutral' },
  ]

  return (
    <div className="page">
      <h1>Money</h1>
      <p className="page-subtitle">How this business is doing, in plain terms.</p>

      <div className="date-range">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && !error && <p>Loading…</p>}

      {!loading && (
        <>
          <div className="summary-grid">
            {cards.map((c) => (
              <div className={'summary-card summary-card--' + c.tone} key={c.label}>
                <span className="summary-label">{c.label}</span>
                <strong className="summary-value">{formatMoney(c.value)}</strong>
                <span className="summary-note">{c.note}</span>
              </div>
            ))}
          </div>

          <details className="statement-detail" open>
            <summary>Where it came from and went ({from} to {to})</summary>
            <div className="statement">
              <section>
                <h2>Income</h2>
                <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    {income.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="num">{formatMoney(c.total)}</td>
                      </tr>
                    ))}
                    {income.length === 0 && (
                      <tr>
                        <td className="empty-state" colSpan={2}>
                          No income in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total Income</td>
                      <td className="num">{formatMoney(totalIncome)}</td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </section>

              <section>
                <h2>Expenses</h2>
                <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    {expense.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="num">{formatMoney(c.total)}</td>
                      </tr>
                    ))}
                    {expense.length === 0 && (
                      <tr>
                        <td className="empty-state" colSpan={2}>
                          No expenses in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total Expenses</td>
                      <td className="num">{formatMoney(totalExpense)}</td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </section>
            </div>
          </details>

          <details className="statement-detail">
            <summary>What you own and owe (as of today)</summary>
            <div className="statement">
              <section>
                <h2>What you own</h2>
                <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.financial_account_id}>
                        <td>{a.name}</td>
                        <td className="num">{formatMoney(a.balance)}</td>
                      </tr>
                    ))}
                    {assets.length === 0 && (
                      <tr>
                        <td className="empty-state" colSpan={2}>
                          No asset accounts yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{formatMoney(totalAssets)}</td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </section>

              <section>
                <h2>What you owe</h2>
                <div className="table-scroll">
                <table className="data-table">
                  <tbody>
                    {liabilities.map((a) => (
                      <tr key={a.financial_account_id}>
                        <td>{a.name}</td>
                        <td className="num">{formatMoney(a.balance)}</td>
                      </tr>
                    ))}
                    {liabilities.length === 0 && (
                      <tr>
                        <td className="empty-state" colSpan={2}>
                          No liability accounts yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{formatMoney(totalLiabilities)}</td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              </section>

              <div className={'net-income' + (equity < 0 ? ' negative' : '')}>
                <span>What it&apos;s worth (Owner&apos;s Equity)</span>
                <span>{formatMoney(equity)}</span>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
