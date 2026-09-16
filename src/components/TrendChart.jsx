import { formatMoney } from '../lib/money'

// Sales and profit for each day in a range: a bar per day, a line across the
// tops for profit. One row per day comes straight out of the daily counts, so
// unlike the Money page's chart (PLChart) there is nothing to bucket.
//
// Days with no count are drawn as zero rather than skipped - a gap in the
// row is itself worth seeing, because it means a day was never closed out.

const W = 760
const H = 220
const PAD = { top: 12, right: 12, bottom: 28, left: 62 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

export default function TrendChart({ days }) {
  if (!days || days.length === 0) return null

  const hi = Math.max(0, ...days.map((d) => Math.max(d.sales, d.profit)))
  const lo = Math.min(0, ...days.map((d) => d.profit))
  const step = niceStep(hi - lo)
  const top = Math.ceil(hi / step) * step || step
  const bottom = Math.floor(lo / step) * step
  const ticks = []
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const y = (v) => PAD.top + plotH - ((v - bottom) / (top - bottom)) * plotH
  const slot = plotW / days.length
  const barW = Math.max(2, Math.min(slot * 0.62, 30))
  const cx = (i) => PAD.left + slot * (i + 0.5)
  const zero = y(0)
  const labelEvery = Math.ceil(days.length / 8)
  const line = days.map((d, i) => `${cx(i).toFixed(1)},${y(d.profit).toFixed(1)}`).join(' ')
  const label = (iso) => {
    const [, m, d] = iso.split('-').map(Number)
    return `${MONTHS[m - 1]} ${d}`
  }

  return (
    <section className="pl-chart" aria-label="Sales and profit by day">
      <div className="pl-chart-head">
        <h2>Day by day</h2>
        <div className="pl-legend">
          <span>
            <i className="pl-swatch" style={{ background: 'var(--green)' }} /> Sales
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
              style={{
                stroke: Math.abs(t) < step / 1000 ? 'var(--muted)' : 'var(--border)',
                strokeWidth: Math.abs(t) < step / 1000 ? 1.25 : 1,
              }}
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
              {shortMoney(t)}
            </text>
          </g>
        ))}

        {days.map((d, i) => (
          <g key={d.date}>
            <rect
              x={cx(i) - barW / 2}
              y={Math.min(y(d.sales), zero)}
              width={barW}
              height={Math.abs(zero - y(d.sales))}
              rx={Math.min(3, barW / 3)}
              style={{ fill: d.counted ? 'var(--green)' : 'var(--border)' }}
            />
            {i % labelEvery === 0 && (
              <text x={cx(i)} y={H - 8} textAnchor="middle">
                {label(d.date)}
              </text>
            )}
            <rect x={cx(i) - slot / 2} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} style={{ fill: 'transparent' }}>
              <title>
                {d.counted
                  ? `${label(d.date)}\nSales ${formatMoney(d.sales)}\nCost ${formatMoney(d.cost)}\nProfit ${formatMoney(d.profit)}`
                  : `${label(d.date)}\nNot closed out`}
              </title>
            </rect>
          </g>
        ))}

        {days.length > 1 && (
          <polyline
            points={line}
            style={{
              fill: 'none',
              stroke: 'var(--gold-dark)',
              strokeWidth: 2.5,
              strokeLinejoin: 'round',
              strokeLinecap: 'round',
              pointerEvents: 'none',
            }}
          />
        )}
        {days.length <= 40 &&
          days.map((d, i) => (
            <circle
              key={d.date}
              cx={cx(i)}
              cy={y(d.profit)}
              r={3.5}
              style={{ fill: 'white', stroke: 'var(--gold-dark)', strokeWidth: 2, pointerEvents: 'none' }}
            />
          ))}
      </svg>
    </section>
  )
}
