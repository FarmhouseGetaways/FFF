import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, todayISO } from '../lib/money'

// What it costs to run the place against what it costs to stock it
// (16 Sep 2026, Cory: "Cost Snapshot ... Operation cost vs vendor cost").
//
// The two come from different places on purpose:
//   * vendor cost is the wholesale cost of everything put out, taken from
//     the daily counts, so it is right even for stock that was never
//     entered as a bill.
//   * operating cost is every other expense in the ledger - rent, fuel,
//     fees, supplies - for the same range.
//
// A daily count posts its own cost line when "record what I paid" is on,
// and someone may also enter the vendor's bill by hand. Either of those
// would double-count against the counts, so ledger rows that look like
// stock are pulled out of operating cost and shown on their own as a
// cross-check rather than added to the total.

const STOCK_CATEGORY = /cost of goods|cogs|inventory|wholesale|vendor|product/i

function startOfYear() {
  return `${new Date().getFullYear()}-01-01`
}

const num = (v) => (v == null ? 0 : Number(v) || 0)

function share(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 100)
}

export default function CostSnapshot() {
  const { entityId } = useOutletContext()
  const [from, setFrom] = useState(startOfYear())
  const [to, setTo] = useState(todayISO())
  const [lines, setLines] = useState(null)
  const [txns, setTxns] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLines(null)
    supabase
      .from('daily_closeouts')
      .select('close_date, lines:daily_count_lines(vendor, product_name, ordered, sold, price, cost)')
      .eq('entity_id', entityId)
      .gte('close_date', from)
      .lte('close_date', to)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setError(error.message)
          setLines([])
        } else setLines(data.flatMap((d) => d.lines))
      })
    return () => {
      active = false
    }
  }, [entityId, from, to])

  useEffect(() => {
    let active = true
    setTxns(null)
    supabase
      .from('transactions')
      .select('amount, txn_date, source, category:categories(name, category_type)')
      .eq('entity_id', entityId)
      .not('category_id', 'is', null)
      .gte('txn_date', from)
      .lte('txn_date', to)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setError(error.message)
          setTxns([])
        } else setTxns(data)
      })
    return () => {
      active = false
    }
  }, [entityId, from, to])

  const vendor = useMemo(() => {
    const byVendor = new Map()
    let total = 0
    let sales = 0
    for (const l of lines ?? []) {
      const cost = num(l.ordered) * num(l.cost)
      total += cost
      sales += num(l.sold) * num(l.price)
      const key = l.vendor || 'No vendor set'
      byVendor.set(key, (byVendor.get(key) ?? 0) + cost)
    }
    return {
      total,
      sales,
      rows: [...byVendor.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    }
  }, [lines])

  const operating = useMemo(() => {
    const byCategory = new Map()
    let total = 0
    let stockInBooks = 0
    for (const t of txns ?? []) {
      if (!t.category || t.category.category_type !== 'expense') continue
      const amount = Math.abs(Number(t.amount))
      // Anything that is really stock is left out - the counts already
      // carry it, and adding it here would charge the same crate twice.
      if (t.source === 'daily_count' || STOCK_CATEGORY.test(t.category.name)) {
        stockInBooks += amount
        continue
      }
      total += amount
      byCategory.set(t.category.name, (byCategory.get(t.category.name) ?? 0) + amount)
    }
    return {
      total,
      stockInBooks,
      rows: [...byCategory.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    }
  }, [txns])

  const loading = lines === null || txns === null
  const totalCost = operating.total + vendor.total
  const vendorShare = share(vendor.total, totalCost)
  const perDollar = vendor.total ? operating.total / vendor.total : null

  return (
    <div className="page page--wide">
      <h1>Cost Snapshot</h1>
      <p className="page-subtitle">What it costs to stock the stand against what it costs to run it.</p>

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
          <div className="summary-grid summary-grid--three">
            <div className="summary-card summary-card--out">
              <span className="summary-label">Vendor cost</span>
              <strong className="summary-value">{formatMoney(vendor.total)}</strong>
              <span className="summary-note">
                Wholesale cost of everything put out, from your <Link to="../daily-count">counts</Link>.
              </span>
            </div>
            <div className="summary-card summary-card--out">
              <span className="summary-label">Operating cost</span>
              <strong className="summary-value">{formatMoney(operating.total)}</strong>
              <span className="summary-note">Every other expense in your books for this range.</span>
            </div>
            <div className="summary-card summary-card--neutral">
              <span className="summary-label">Both together</span>
              <strong className="summary-value">{formatMoney(totalCost)}</strong>
              <span className="summary-note">
                {perDollar == null
                  ? 'Nothing counted in this range yet.'
                  : `${formatMoney(perDollar)} spent running the place for every $1 of stock.`}
              </span>
            </div>
          </div>

          {totalCost > 0 && (
            <section className="trend-block">
              <h2>Where the money goes</h2>
              <p className="page-subtitle">
                {vendorShare}% of what you spend is stock; {100 - vendorShare}% is running the business.
              </p>
              <div className="cost-split" role="img" aria-label={`Vendor cost ${vendorShare}%, operating cost ${100 - vendorShare}%`}>
                <div className="cost-split-part cost-split-part--vendor" style={{ width: `${vendorShare}%` }}>
                  {vendorShare >= 12 && <span>Stock {vendorShare}%</span>}
                </div>
                <div className="cost-split-part cost-split-part--operating" style={{ width: `${100 - vendorShare}%` }}>
                  {100 - vendorShare >= 12 && <span>Running it {100 - vendorShare}%</span>}
                </div>
              </div>
              {vendor.sales > 0 && (
                <p className="page-subtitle">
                  Sales over the same range were {formatMoney(vendor.sales)}, leaving{' '}
                  {formatMoney(vendor.sales - totalCost)} after both.
                </p>
              )}
            </section>
          )}

          <section className="trend-block">
            <h2>Operating cost</h2>
            <p className="page-subtitle">
              From <Link to="../transactions">Transactions</Link>, by category. Rent, fuel, fees, supplies -
              everything the stand costs whether or not a single thing sells.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th className="num">Share of operating cost</th>
                  </tr>
                </thead>
                <tbody>
                  {operating.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td className="num">{formatMoney(r.amount)}</td>
                      <td className="num">{share(r.amount, operating.total)}%</td>
                    </tr>
                  ))}
                  {operating.rows.length === 0 && (
                    <tr>
                      <td className="empty-state" colSpan={3}>
                        No operating expenses recorded in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>All operating cost</td>
                    <td className="num">{formatMoney(operating.total)}</td>
                    <td className="num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {operating.stockInBooks > 0 && (
              <p className="form-info">
                {formatMoney(operating.stockInBooks)} of stock bills is also recorded in your books for this
                range. It is left out of the figures above so it isn&apos;t counted twice against your counts.
              </p>
            )}
          </section>

          <section className="trend-block">
            <h2>Vendor cost</h2>
            <p className="page-subtitle">
              What you paid your vendors for everything you put out, by vendor.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th className="num">Cost of what you ordered</th>
                    <th className="num">Share of vendor cost</th>
                  </tr>
                </thead>
                <tbody>
                  {vendor.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td className="num">{formatMoney(r.amount)}</td>
                      <td className="num">{share(r.amount, vendor.total)}%</td>
                    </tr>
                  ))}
                  {vendor.rows.length === 0 && (
                    <tr>
                      <td className="empty-state" colSpan={3}>
                        No days counted in this range. Close out a day on{' '}
                        <Link to="../daily-count">The Numbers</Link> and it shows up here.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>All vendor cost</td>
                    <td className="num">{formatMoney(vendor.total)}</td>
                    <td className="num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
