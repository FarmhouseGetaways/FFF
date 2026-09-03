import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/money'

function startOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function monthName() {
  return new Date().toLocaleDateString(undefined, { month: 'long' })
}

// The numbers someone actually wants on opening the app: what came in this
// month, what went out, what that leaves, and what's in the bank right now.
// Deliberately month-to-date rather than year - "how am I doing" is a
// this-month question, and the P&L page already covers any date range.
export default function HomeSummary() {
  const [totals, setTotals] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      const [{ data: txns, error: tErr }, { data: balances, error: bErr }] = await Promise.all([
        supabase
          .from('transactions')
          .select('amount')
          .not('category_id', 'is', null)
          .gte('txn_date', startOfMonth())
          .lte('txn_date', today()),
        supabase.from('account_balances').select('balance, account_type, is_archived'),
      ])

      if (!active) return
      if (tErr || bErr) {
        setError((tErr || bErr).message)
        return
      }

      let inn = 0
      let out = 0
      for (const t of txns ?? []) {
        const amt = Number(t.amount)
        if (amt >= 0) inn += amt
        else out += Math.abs(amt)
      }

      // Liabilities are stored as negative balances, so a plain sum of the
      // asset accounts is what "on hand" means here - cards and loans are
      // their own story and would make this number lie.
      const ASSETS = ['checking', 'savings', 'cash', 'venmo', 'other_asset']
      const onHand = (balances ?? [])
        .filter((b) => !b.is_archived && ASSETS.includes(b.account_type))
        .reduce((sum, b) => sum + Number(b.balance), 0)

      setTotals({ inn, out, net: inn - out, onHand })
    }

    load()
    return () => {
      active = false
    }
  }, [])

  if (error) return <p className="form-error">{error}</p>
  if (!totals) return <div className="summary-grid summary-grid--loading">Loading your numbers…</div>

  // Labels say the DIRECTION of the money and then the period, in that
  // order - "Money in, September" was read as "money that went out in
  // September", because "in/out" sitting next to a month name reads as
  // part of the date, not as the direction. "Incoming"/"Outgoing" can't be
  // misread that way.
  //
  // The first three are this month only; the fourth is a right-now
  // balance. That difference is the whole reason "On hand" was confusing
  // next to them, so the label now says "right now" out loud instead of
  // leaving the reader to infer a different time scale from a two-word
  // banking term.
  const cards = [
    {
      label: `Incoming money — ${monthName()}`,
      value: totals.inn,
      note: 'Everything you took in this month, across every entity.',
      tone: 'in',
    },
    {
      label: `Outgoing money — ${monthName()}`,
      value: totals.out,
      note: 'Everything you spent this month, across every entity.',
      tone: 'out',
    },
    {
      label: `Profit — ${monthName()}`,
      value: totals.net,
      note:
        totals.net >= 0
          ? 'Incoming minus outgoing. You took in more than you spent.'
          : 'Incoming minus outgoing. You spent more than you took in.',
      tone: totals.net >= 0 ? 'in' : 'out',
    },
    {
      label: 'Money you have right now',
      value: totals.onHand,
      note: 'Cash, checking, savings and Venmo added up — today, not just this month.',
      tone: 'neutral',
    },
  ]

  return (
    <div className="summary-grid">
      {cards.map((c) => (
        <div className={'summary-card summary-card--' + c.tone} key={c.label}>
          <span className="summary-label">{c.label}</span>
          <strong className="summary-value">{formatMoney(c.value)}</strong>
          <span className="summary-note">{c.note}</span>
        </div>
      ))}
    </div>
  )
}
