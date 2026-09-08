import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * How much the accounting side is actually being used, per member.
 *
 * COUNTS AND DATES ONLY. No amounts, no balances, no profit, no category, no
 * description. Cory's rule, 7 Sep 2026: we want to know somebody is using it,
 * not what they entered. The server does not fetch the rows at all - it asks
 * Postgres for a count - so there is nothing here to leak even by accident.
 *
 * What it is FOR: spotting the customer who signed up, added two businesses
 * and then stopped, while there is still time to ring them.
 *
 * ARCHIVED MEMBERS GET A SEPARATE VIEW, same toggle as Admin's Accounts tab
 * (7 Sep 2026, one visual language for "there's an archived list" rather than
 * mixing them into the active one with nothing to say they aren't live).
 */
export default function AdminUsage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/.netlify/functions/admin-fleet', {
          headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
        if (active) setData(body)
      } catch (err) {
        if (active) setError(String(err.message || err))
      }
    })()
    return () => { active = false }
  }, [])

  if (error) return <p className="form-error">{error}</p>
  if (!data) return <p>Loading…</p>

  const visible = data.usage.filter((u) => (showArchived ? u.isArchived : !u.isArchived))

  return (
    <>
      <p className="page-subtitle">
        Whether people are using it, not what they entered. No amounts, no balances, and no
        transaction details are read — the server asks the database for a count and nothing else.
      </p>

      <div className="page-actions" style={{ marginBottom: '1rem' }}>
        <button className="header-btn" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? '← Back to active members' : 'View archived members'}
        </button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Joined</th>
              <th>Businesses</th>
              <th>Entries, 30 days</th>
              <th>Entries, all time</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr key={u.userId}>
                <td>
                  {u.email}
                  {u.isAdmin ? ' (admin)' : ''}
                </td>
                <td>{u.joined ? new Date(u.joined).toLocaleDateString() : '—'}</td>
                <td>{u.businesses}</td>
                {/* Nought entries in a month is the number worth acting on, so
                    it is marked rather than left to be spotted in a column. */}
                <td className={u.transactions30d === 0 ? 'cell-quiet' : ''}>
                  {u.transactions30d === 0 ? 'none' : u.transactions30d}
                </td>
                <td>{u.transactionsTotal}</td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="empty-state">
                  {showArchived ? 'No archived members.' : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
