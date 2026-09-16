import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, todayISO } from '../lib/money'
import TrendChart from '../components/TrendChart.jsx'

// What the daily counts add up to over time (16 Sep 2026). Everything above
// the catalog section is measured from daily_count_lines - the price and
// wholesale cost as they were on the day, not as they are now - so these
// numbers stay true even after a price change.
//
// Two different margins live on this page and they will not agree. The one
// in the big table is margin on what actually sold, over the date range.
// The one in the catalog section is list markup at today's prices, whether
// or not a thing has ever sold. Both are labelled as what they are.
//
// Items with no wholesale price count as $0 cost everywhere, which quietly
// overstates profit, so the catalog section names them.

const MS_DAY = 86400000

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function eachDate(from, to) {
  const out = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const end = new Date(ty, tm - 1, td).getTime()
  for (let t = new Date(fy, fm - 1, fd).getTime(); t <= end; t += MS_DAY) {
    const d = new Date(t)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const num = (v) => (v == null ? 0 : Number(v) || 0)

// Percentages of nothing are not zero, they're nothing - a day with no
// sales has no margin, and printing "0%" would read as a terrible day.
function pct(part, whole) {
  if (!whole) return null
  return (part / whole) * 100
}

function showPct(v, digits = 0) {
  return v == null ? '—' : `${v.toFixed(digits)}%`
}

const GROUPS = [
  { key: 'vendor', label: 'Vendor' },
  { key: 'category', label: 'Category' },
  { key: 'item', label: 'Item' },
]

export default function Trends() {
  const { entityId } = useOutletContext()
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(todayISO())
  const [lines, setLines] = useState(null)
  const [closeouts, setCloseouts] = useState(null)
  const [products, setProducts] = useState(null)
  const [groupBy, setGroupBy] = useState('vendor')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLines(null)
    setCloseouts(null)
    // Two queries rather than one embedded filter: the lines don't carry
    // the date, only the close-out they belong to.
    supabase
      .from('daily_closeouts')
      .select('id, close_date')
      .eq('entity_id', entityId)
      .gte('close_date', from)
      .lte('close_date', to)
      .order('close_date')
      .then(async ({ data, error }) => {
        if (!active) return
        if (error) {
          setError(error.message)
          setCloseouts([])
          setLines([])
          return
        }
        setCloseouts(data)
        if (data.length === 0) {
          setLines([])
          return
        }
        const res = await supabase
          .from('daily_count_lines')
          .select('closeout_id, product_id, product_name, vendor, ordered, sold, price, cost')
          .in(
            'closeout_id',
            data.map((c) => c.id)
          )
        if (!active) return
        if (res.error) {
          setError(res.error.message)
          setLines([])
        } else setLines(res.data)
      })
    return () => {
      active = false
    }
  }, [entityId, from, to])

  useEffect(() => {
    let active = true
    setProducts(null)
    supabase
      .from('products')
      .select('id, name, vendor, category, price, cost')
      .eq('entity_id', entityId)
      .eq('is_archived', false)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setProducts(data)
      })
    return () => {
      active = false
    }
  }, [entityId])

  const categoryOf = useMemo(() => {
    const m = new Map()
    for (const p of products ?? []) m.set(p.id, p.category || null)
    return m
  }, [products])

  const totals = useMemo(() => {
    let sales = 0
    let cost = 0
    let ordered = 0
    let sold = 0
    for (const l of lines ?? []) {
      sales += num(l.sold) * num(l.price)
      cost += num(l.ordered) * num(l.cost)
      ordered += num(l.ordered)
      sold += num(l.sold)
    }
    return { sales, cost, profit: sales - cost, ordered, sold }
  }, [lines])

  const days = useMemo(() => {
    const byDate = new Map()
    const dateOf = new Map((closeouts ?? []).map((c) => [c.id, c.close_date]))
    for (const l of lines ?? []) {
      const date = dateOf.get(l.closeout_id)
      if (!date) continue
      const d = byDate.get(date) ?? { date, sales: 0, cost: 0, profit: 0, counted: true }
      d.sales += num(l.sold) * num(l.price)
      d.cost += num(l.ordered) * num(l.cost)
      d.profit = d.sales - d.cost
      byDate.set(date, d)
    }
    // A close-out with no lines on it is still a day that was counted.
    for (const c of closeouts ?? []) {
      if (!byDate.has(c.close_date)) byDate.set(c.close_date, { date: c.close_date, sales: 0, cost: 0, profit: 0, counted: true })
    }
    const span = eachDate(from, to)
    // Past a season's worth of days, one bar per calendar day is unreadable,
    // so only the days that were counted get a slot.
    if (span.length > 92) return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
    return span.map((date) => byDate.get(date) ?? { date, sales: 0, cost: 0, profit: 0, counted: false })
  }, [lines, closeouts, from, to])

  const countedDays = useMemo(() => days.filter((d) => d.counted), [days])
  const bestDay = useMemo(
    () => countedDays.reduce((best, d) => (best == null || d.sales > best.sales ? d : best), null),
    [countedDays]
  )

  const groups = useMemo(() => {
    const m = new Map()
    for (const l of lines ?? []) {
      const key =
        groupBy === 'vendor'
          ? l.vendor || 'No vendor set'
          : groupBy === 'category'
            ? categoryOf.get(l.product_id) || 'No category set'
            : l.product_name || 'Unnamed item'
      const g = m.get(key) ?? { key, ordered: 0, sold: 0, sales: 0, cost: 0 }
      g.ordered += num(l.ordered)
      g.sold += num(l.sold)
      g.sales += num(l.sold) * num(l.price)
      g.cost += num(l.ordered) * num(l.cost)
      m.set(key, g)
    }
    return [...m.values()]
      .map((g) => ({
        ...g,
        profit: g.sales - g.cost,
        margin: pct(g.sales - g.cost, g.sales),
        sellThrough: pct(g.sold, g.ordered),
        share: pct(g.sales, totals.sales),
      }))
      .sort((a, b) => b.sales - a.sales)
  }, [lines, groupBy, categoryOf, totals.sales])

  // What got ordered and didn't sell, at what it cost to put it there.
  const leftovers = useMemo(() => {
    const m = new Map()
    for (const l of lines ?? []) {
      const key = l.product_name || 'Unnamed item'
      const g = m.get(key) ?? { key, vendor: l.vendor, units: 0, value: 0, ordered: 0 }
      const left = num(l.ordered) - num(l.sold)
      g.units += left
      g.value += left * num(l.cost)
      g.ordered += num(l.ordered)
      m.set(key, g)
    }
    return [...m.values()].filter((g) => g.units > 0).sort((a, b) => b.units - a.units)
  }, [lines])

  const leftoverValue = useMemo(() => leftovers.reduce((s, g) => s + g.value, 0), [leftovers])

  const catalog = useMemo(() => {
    const list = products ?? []
    const priced = list.filter((p) => num(p.cost) > 0 && num(p.price) > 0)
    const missingCost = list.filter((p) => !(num(p.cost) > 0))
    const byVendor = new Map()
    for (const p of list) {
      const key = p.vendor || 'No vendor set'
      const v = byVendor.get(key) ?? { key, items: 0, price: 0, cost: 0, priced: 0, missing: 0 }
      v.items += 1
      if (num(p.cost) > 0 && num(p.price) > 0) {
        v.priced += 1
        v.price += num(p.price)
        v.cost += num(p.cost)
      } else v.missing += 1
      byVendor.set(key, v)
    }
    const vendors = [...byVendor.values()]
      .map((v) => ({
        ...v,
        avgPrice: v.priced ? v.price / v.priced : null,
        avgCost: v.priced ? v.cost / v.priced : null,
        markup: v.priced ? pct(v.price - v.cost, v.cost) : null,
        margin: v.priced ? pct(v.price - v.cost, v.price) : null,
      }))
      .sort((a, b) => b.items - a.items)
    const totalPrice = priced.reduce((s, p) => s + num(p.price), 0)
    const totalCost = priced.reduce((s, p) => s + num(p.cost), 0)
    return {
      count: list.length,
      namedVendors: vendors.filter((v) => v.key !== 'No vendor set').length,
      priced: priced.length,
      missingCost,
      vendors,
      markup: pct(totalPrice - totalCost, totalCost),
      margin: pct(totalPrice - totalCost, totalPrice),
    }
  }, [products])

  const loading = lines === null || closeouts === null || products === null
  const hasCounts = countedDays.length > 0

  const cards = [
    { label: 'Sales', value: formatMoney(totals.sales), note: `${countedDays.length} day${countedDays.length === 1 ? '' : 's'} closed out in this range.`, tone: 'in' },
    { label: 'Cost of what you ordered', value: formatMoney(totals.cost), note: 'Wholesale cost of everything put out, sold or not.', tone: 'out' },
    {
      label: 'Profit',
      value: formatMoney(totals.profit),
      note: 'Sales less what the stock cost you.',
      tone: totals.profit > 0 ? 'in' : totals.profit < 0 ? 'out' : 'neutral',
    },
    {
      label: 'Margin',
      value: showPct(pct(totals.profit, totals.sales), 1),
      note: 'What you kept out of every dollar that came in.',
      tone: 'neutral',
    },
  ]

  const secondRow = [
    {
      label: 'Sell-through',
      value: showPct(pct(totals.sold, totals.ordered)),
      note: `${totals.sold} of ${totals.ordered} items put out were sold.`,
      tone: 'neutral',
    },
    {
      label: 'Left over',
      value: formatMoney(leftoverValue),
      note: 'What the unsold stock cost you, added up across the days.',
      tone: 'out',
    },
    {
      label: 'Best day',
      value: bestDay ? formatMoney(bestDay.sales) : '—',
      note: bestDay ? prettyDate(bestDay.date) : 'No days closed out yet.',
      tone: 'in',
    },
  ]

  return (
    <div className="page page--wide">
      <h1>Trends</h1>
      <p className="page-subtitle">What sells, what sits, and what each vendor is actually earning you.</p>

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
          {!hasCounts && (
            <p className="form-info">
              No days were closed out between {from} and {to}, so there is nothing to chart yet. Fill in a{' '}
              <Link to="../daily-count">daily count</Link> at the end of a day and it shows up here. The catalog
              numbers at the bottom of this page work right away.
            </p>
          )}

          {hasCounts && (
            <>
              <div className="summary-grid">
                {cards.map((c) => (
                  <div className={'summary-card summary-card--' + c.tone} key={c.label}>
                    <span className="summary-label">{c.label}</span>
                    <strong className="summary-value">{c.value}</strong>
                    <span className="summary-note">{c.note}</span>
                  </div>
                ))}
              </div>

              <div className="summary-grid summary-grid--three">
                {secondRow.map((c) => (
                  <div className={'summary-card summary-card--' + c.tone} key={c.label}>
                    <span className="summary-label">{c.label}</span>
                    <strong className="summary-value">{c.value}</strong>
                    <span className="summary-note">{c.note}</span>
                  </div>
                ))}
              </div>

              <TrendChart days={days} />

              <section className="trend-block">
                <div className="trend-head">
                  <h2>Margin on what sold</h2>
                  <div className="trend-tabs" role="group" aria-label="Group by">
                    {GROUPS.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        className={'trend-tab' + (groupBy === g.key ? ' is-on' : '')}
                        onClick={() => setGroupBy(g.key)}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="page-subtitle">
                  Prices and wholesale costs as they were on each day, added up across {from} to {to}.
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{GROUPS.find((g) => g.key === groupBy).label}</th>
                        <th className="num">Sold</th>
                        <th className="num">Sell-through</th>
                        <th className="num">Sales</th>
                        <th className="num">Cost</th>
                        <th className="num">Profit</th>
                        <th className="num">Margin</th>
                        <th className="num">Share of sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.key}>
                          <td>{g.key}</td>
                          <td className="num">{g.sold}</td>
                          <td className="num">{showPct(g.sellThrough)}</td>
                          <td className="num">{formatMoney(g.sales)}</td>
                          <td className="num">{formatMoney(g.cost)}</td>
                          <td className={'num' + (g.profit < 0 ? ' negative' : '')}>{formatMoney(g.profit)}</td>
                          <td className={'num' + (g.margin != null && g.margin < 0 ? ' negative' : '')}>
                            {showPct(g.margin)}
                          </td>
                          <td className="num">{showPct(g.share)}</td>
                        </tr>
                      ))}
                      {groups.length === 0 && (
                        <tr>
                          <td className="empty-state" colSpan={8}>
                            Nothing counted in this range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>All</td>
                        <td className="num">{totals.sold}</td>
                        <td className="num">{showPct(pct(totals.sold, totals.ordered))}</td>
                        <td className="num">{formatMoney(totals.sales)}</td>
                        <td className="num">{formatMoney(totals.cost)}</td>
                        <td className={'num' + (totals.profit < 0 ? ' negative' : '')}>{formatMoney(totals.profit)}</td>
                        <td className="num">{showPct(pct(totals.profit, totals.sales))}</td>
                        <td className="num">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              <section className="trend-block">
                <h2>What got left over</h2>
                <p className="page-subtitle">
                  Ordered but not sold, worst first, at what it cost you. Small numbers here are a stand that is
                  stocked about right.
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Vendor</th>
                        <th className="num">Put out</th>
                        <th className="num">Left over</th>
                        <th className="num">Sell-through</th>
                        <th className="num">Cost of the leftovers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leftovers.slice(0, 25).map((g) => (
                        <tr key={g.key}>
                          <td>{g.key}</td>
                          <td>{g.vendor || '—'}</td>
                          <td className="num">{g.ordered}</td>
                          <td className="num">{g.units}</td>
                          <td className="num">{showPct(pct(g.ordered - g.units, g.ordered))}</td>
                          <td className="num">{formatMoney(g.value)}</td>
                        </tr>
                      ))}
                      {leftovers.length === 0 && (
                        <tr>
                          <td className="empty-state" colSpan={6}>
                            Nothing was left over in this range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {leftovers.length > 25 && <p className="page-subtitle">Showing the 25 worst of {leftovers.length}.</p>}
              </section>
            </>
          )}

          <section className="trend-block">
            <h2>Your catalog today</h2>
            <p className="page-subtitle">
              Straight from <Link to="../inventory">Inventory</Link> at today's prices - not what sold. Markup is what
              you add on top of wholesale; margin is what is left of the selling price after wholesale.
            </p>
            <div className="summary-grid summary-grid--three">
              <div className="summary-card summary-card--neutral">
                <span className="summary-label">Items for sale</span>
                <strong className="summary-value">{catalog.count}</strong>
                <span className="summary-note">
                  Across {catalog.namedVendors} vendor{catalog.namedVendors === 1 ? '' : 's'}.
                </span>
              </div>
              <div className="summary-card summary-card--in">
                <span className="summary-label">Average markup</span>
                <strong className="summary-value">{showPct(catalog.markup)}</strong>
                <span className="summary-note">
                  {catalog.priced} item{catalog.priced === 1 ? '' : 's'} with both a wholesale and a selling price.
                  Margin {showPct(catalog.margin)}.
                </span>
              </div>
              <div className={'summary-card summary-card--' + (catalog.missingCost.length ? 'out' : 'neutral')}>
                <span className="summary-label">Missing a wholesale price</span>
                <strong className="summary-value">{catalog.missingCost.length}</strong>
                <span className="summary-note">
                  {catalog.missingCost.length
                    ? 'These count as free stock, so every profit number above is flattering.'
                    : 'Every item has a wholesale price. Profit figures are honest.'}
                </span>
              </div>
            </div>

            {catalog.missingCost.length > 0 && (
              <p className="form-notice">
                No wholesale price on:{' '}
                {catalog.missingCost
                  .slice(0, 12)
                  .map((p) => p.name)
                  .join(', ')}
                {catalog.missingCost.length > 12 ? ` and ${catalog.missingCost.length - 12} more` : ''}.{' '}
                <Link to="../inventory">Fill them in</Link> and these figures correct themselves.
              </p>
            )}

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th className="num">Items</th>
                    <th className="num">Average wholesale</th>
                    <th className="num">Average price</th>
                    <th className="num">List markup</th>
                    <th className="num">List margin</th>
                    <th className="num">No wholesale price</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.vendors.map((v) => (
                    <tr key={v.key}>
                      <td>{v.key}</td>
                      <td className="num">{v.items}</td>
                      <td className="num">{v.avgCost == null ? '—' : formatMoney(v.avgCost)}</td>
                      <td className="num">{v.avgPrice == null ? '—' : formatMoney(v.avgPrice)}</td>
                      <td className="num">{showPct(v.markup)}</td>
                      <td className="num">{showPct(v.margin)}</td>
                      <td className="num">{v.missing || '—'}</td>
                    </tr>
                  ))}
                  {catalog.vendors.length === 0 && (
                    <tr>
                      <td className="empty-state" colSpan={7}>
                        Nothing in your inventory yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
