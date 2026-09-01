import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/money'

const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'other_liability'])

export default function BalanceSheet() {
  const { entityId } = useOutletContext()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setRows(null)
    supabase
      .from('account_balances')
      .select('*')
      .eq('entity_id', entityId)
      .eq('is_archived', false)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setRows(data)
      })
    return () => {
      active = false
    }
  }, [entityId])

  const { assets, liabilities, totalAssets, totalLiabilities, equity } = useMemo(() => {
    const assets = (rows ?? []).filter((r) => !LIABILITY_TYPES.has(r.account_type))
    const liabilities = (rows ?? []).filter((r) => LIABILITY_TYPES.has(r.account_type))
    const totalAssets = assets.reduce((s, r) => s + Number(r.balance), 0)
    const totalLiabilities = liabilities.reduce((s, r) => s + Number(r.balance), 0)
    return { assets, liabilities, totalAssets, totalLiabilities, equity: totalAssets - totalLiabilities }
  }, [rows])

  return (
    <div className="page">
      <h1>Balance Sheet</h1>
      <p className="page-subtitle">As of today. Equity is calculated as Assets minus Liabilities.</p>

      {error && <p className="form-error">{error}</p>}
      {rows === null && !error && <p>Loading…</p>}

      {rows && (
        <div className="statement">
          <section>
            <h2>Assets</h2>
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
                  <td>Total Assets</td>
                  <td className="num">{formatMoney(totalAssets)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section>
            <h2>Liabilities</h2>
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
                  <td>Total Liabilities</td>
                  <td className="num">{formatMoney(totalLiabilities)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <div className="net-income">
            <span>Owner&apos;s Equity</span>
            <span>{formatMoney(equity)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
