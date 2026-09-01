import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/money'

function startOfYear() {
  const d = new Date()
  return `${d.getFullYear()}-01-01`
}
function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function ProfitLoss() {
  const { entityId } = useOutletContext()
  const [from, setFrom] = useState(startOfYear())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setRows(null)
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
        else setRows(data)
      })
    return () => {
      active = false
    }
  }, [entityId, from, to])

  const { income, expense, totalIncome, totalExpense, netIncome } = useMemo(() => {
    const byCategory = new Map()
    for (const r of rows ?? []) {
      if (!r.category) continue
      const key = r.category.id
      const existing = byCategory.get(key) ?? {
        name: r.category.name,
        type: r.category.category_type,
        total: 0,
      }
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
  }, [rows])

  return (
    <div className="page">
      <h1>Profit &amp; Loss</h1>

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
      {rows === null && !error && <p>Loading…</p>}

      {rows && (
        <div className="statement">
          <section>
            <h2>Income</h2>
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
          </section>

          <section>
            <h2>Expenses</h2>
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
          </section>

          <div className={'net-income' + (netIncome < 0 ? ' negative' : '')}>
            <span>Net Income</span>
            <span>{formatMoney(netIncome)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
