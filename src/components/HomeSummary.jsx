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
//
// Pass an entityId to scope it to one business; leave it off for the
// everything-added-up view on the home page. Same component both places on
// purpose - the four numbers mean the same thing whichever scope you're in,
// and two implementations would be two places for them to drift apart.
export default function HomeSummary({ entityId = null }) {
  const [totals, setTotals] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      let txnQuery = supabase
        .from('transactions')
        .select('amount')
        .not('category_id', 'is', null)
        .gte('txn_date', startOfMonth())
        .lte('txn_date', today())
      let balanceQuery = supabase.from('account_balances').select('balance, account_type, is_archived')

      if (entityId) {
        txnQuery = txnQuery.eq('entity_id', entityId)
        balanceQuery = balanceQuery.eq('entity_id', entityId)
      }

      const [{ data: txns, error: tErr }, { data: balances, error: bErr }] = await Promise.all([
        txnQuery,
        balanceQuery,
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
  }, [entityId])

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
  // Say which scope the number covers right in the note - the same card on
  // the home page and inside a business would otherwise look identical
  // while meaning very different things.
  const scope = entityId ? 'for this business' : 'across every business you run'

  const cards = [
    {
      label: `Incoming money — ${monthName()}`,
      value: totals.inn,
      note: `Everything you took in this month, ${scope}.`,
      tone: 'in',
    },
    {
      label: `Outgoing money — ${monthName()}`,
      value: totals.out,
      note: `Everything you spent this month, ${scope}.`,
      tone: 'out',
    },
    {
      label: `Profit — ${monthName()}`,
      value: totals.net,
      // Zero is its own case, not a small win - on a fresh month (or a
      // fresh account) this card was claiming "you took in more than you
      // spent" over $0.00, which is a false statement in the one place
      // the numbers are supposed to be trustworthy.
      note:
        totals.inn === 0 && totals.out === 0
          ? 'Nothing recorded yet this month.'
          : totals.net > 0
            ? 'Incoming minus outgoing. You took in more than you spent.'
            : totals.net < 0
              ? 'Incoming minus outgoing. You spent more than you took in.'
              : 'Incoming and outgoing came out exactly even.',
      tone: totals.net > 0 ? 'in' : totals.net < 0 ? 'out' : 'neutral',
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
