import { useMemo } from 'react'
import { formatMoney } from '../lib/money'

// Incoming, outgoing and profit over the Money page's date range, as a bar
// and line chart (14 Sep 2026 - "a graph that shows my P&L"). Hand-drawn
// SVG rather than a chart library: it's one small chart, and the data is
// the same transaction rows Money.jsx already loads for its cards.
//
// Bucket size follows the range so the bars stay readable: days up to about
// a month, weeks up to about six months, months beyond that.

const W = 760
const H = 250
const PAD = { top: 14, right: 12, bottom: 30, left: 62 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const iso = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

function bucketStart(dt, unit) {
  if (unit === 'day') return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  if (unit === 'week') {
    const back = (dt.getDay() + 6) % 7 // weeks start Monday
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - back)
  }
  return new Date(dt.getFullYear(), dt.getMonth(), 1)
}

function nextBucket(dt, unit) {
  if (unit === 'day') return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1)
  if (unit === 'week') return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 7)
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 1)
}

function niceStep(range) {
  const raw = range / 4 || 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

function shortMoney(v) {
  const a = Math.abs(v)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${Math.round(a)}`
  return v < 0 ? `-${s}` : s
}

export default function PLChart({ rows, from, to }) {
  const chart = useMemo(() => {
    if (!from || !to || from > to) return null
    const start = parse(from)
    const end = parse(to)
    const days = Math.round((end - start) / 86400000) + 1
    const unit = days <= 35 ? 'day' : days <= 184 ? 'week' : 'month'

    const buckets = []
    const index = new Map()
    for (let b = bucketStart(start, unit); b <= end; b = nextBucket(b, unit)) {
      index.set(iso(b), buckets.length)
      buckets.push({ date: b, income: 0, expense: 0 })
    }
    if (!buckets.length || buckets.length > 400) return null

    let any = false
    for (const r of rows) {
      if (!r.category || !r.txn_date) continue
      const i = index.get(iso(bucketStart(parse(r.txn_date), unit)))
      if (i === undefined) continue
      any = true
      if (r.category.category_type === 'income') buckets[i].income += Number(r.amount)
      else buckets[i].expense -= Number(r.amount)
    }
    if (!any) return { empty: true }
    for (const b of buckets) b.profit = b.income - b.expense

    const hi = Math.max(0, ...buckets.map((b) => Math.max(b.income, b.expense, b.profit)))
    const lo = Math.min(0, ...buckets.map((b) => Math.min(b.income, b.expense, b.profit)))
    const step = niceStep(hi - lo)
    const top = Math.ceil(hi / step) * step || step
    const bottom = Math.floor(lo / step) * step
    const ticks = []
    for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v)

    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom
    const y = (v) => PAD.top + plotH - ((v - bottom) / (top - bottom)) * plotH
    const slot = plotW / buckets.length
    const barW = Math.max(2, Math.min(slot * 0.36, 26))
    const cx = (i) => PAD.left + slot * (i + 0.5)
    const labelEvery = Math.ceil(buckets.length / 8)
    const sameYear = start.getFullYear() === end.getFullYear()

    const label = (d) =>
      unit === 'month'
        ? `${MONTHS[d.getMonth()]}${sameYear ? '' : ` '${String(d.getFullYear()).slice(2)}`}`
        : `${MONTHS[d.getMonth()]} ${d.getDate()}`

    return { buckets, ticks, y, slot, barW, cx, labelEvery, label, unit, step }
  }, [rows, from, to])

  if (!chart || chart.empty) return null
  const { buckets, ticks, y, slot, barW, cx, labelEvery, label, unit, step } = chart
  const zero = y(0)
  const line = buckets.map((b, i) => `${cx(i).toFixed(1)},${y(b.profit).toFixed(1)}`).join(' ')
  const by = unit === 'day' ? 'By day' : unit === 'week' ? 'By week' : 'By month'

  return (
    <section className="pl-chart" aria-label="Profit and loss chart">
      <div className="pl-chart-head">
        <h2>Profit &amp; loss · {by}</h2>
        <div className="pl-legend">
          <span>
            <i className="pl-swatch" style={{ background: 'var(--green)' }} /> Incoming
          </span>
          <span>
            <i className="pl-swatch" style={{ background: 'var(--red)' }} /> Outgoing
          </span>
          <span>
            <i className="pl-swatch pl-swatch--line" style={{ background: 'var(--gold-dark)' }} /> Profit
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              style={{ stroke: Math.abs(t) < step / 1000 ? 'var(--muted)' : 'var(--border)', strokeWidth: Math.abs(t) < step / 1000 ? 1.25 : 1 }}
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {shortMoney(t)}
            </text>
          </g>
        ))}

        {buckets.map((b, i) => {
          const inTop = y(Math.max(b.income, 0))
          const outTop = y(Math.max(b.expense, 0))
          return (
            <g key={i}>
              <rect
                x={cx(i) - barW - 1}
                y={Math.min(inTop, zero)}
                width={barW}
                height={Math.abs(zero - y(b.income))}
                rx={Math.min(3, barW / 3)}
                style={{ fill: 'var(--green)' }}
              />
              <rect
                x={cx(i) + 1}
                y={Math.min(outTop, zero)}
                width={barW}
                height={Math.abs(zero - y(b.expense))}
                rx={Math.min(3, barW / 3)}
                style={{ fill: 'var(--red)', opacity: 0.85 }}
              />
              {i % labelEvery === 0 && (
                <text x={cx(i)} y={H - 8} textAnchor="middle">
                  {label(b.date)}
                </text>
              )}
              {/* Whole-column hover target, so the exact figures are a hover away. */}
              <rect x={cx(i) - slot / 2} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} style={{ fill: 'transparent' }}>
                <title>
                  {`${unit === 'week' ? 'Week of ' : ''}${label(b.date)}\nIncoming ${formatMoney(b.income)}\nOutgoing ${formatMoney(b.expense)}\nProfit ${formatMoney(b.profit)}`}
                </title>
              </rect>
            </g>
          )
        })}

        {buckets.length > 1 && (
          <polyline
            points={line}
            style={{ fill: 'none', stroke: 'var(--gold-dark)', strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round', pointerEvents: 'none' }}
          />
        )}
        {buckets.length <= 40 &&
          buckets.map((b, i) => (
            <circle
              key={i}
              cx={cx(i)}
              cy={y(b.profit)}
              r={3.5}
              style={{ fill: 'white', stroke: 'var(--gold-dark)', strokeWidth: 2, pointerEvents: 'none' }}
            />
          ))}
      </svg>
    </section>
  )
}
