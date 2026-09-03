import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Admin() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  async function load() {
    setError('')
    const [{ data: profiles, error: pErr }, { data: subs, error: sErr }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, created_at, is_admin').order('created_at'),
      supabase
        .from('subscriptions')
        .select('user_id, status, provider, provider_subscription_id, cancel_at, updated_at'),
    ])
    if (pErr || sErr) {
      setError((pErr || sErr).message)
      return
    }
    const subsByUser = new Map(subs.map((s) => [s.user_id, s]))
    setRows(profiles.map((p) => ({ ...p, subscription: subsByUser.get(p.id) ?? null })))
  }

  useEffect(() => {
    load()
  }, [])

  async function setStatus(userId, status) {
    setBusyId(userId)
    await supabase
      .from('subscriptions')
      .upsert(
        { user_id: userId, provider: 'manual', status, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    await load()
    setBusyId(null)
  }

  async function scheduleCancellation(userId, action) {
    setBusyId(userId)
    setError('')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/.netlify/functions/admin-schedule-cancellation', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      })
      if (!res.ok) throw new Error(await res.text())
      await load()
    } catch (err) {
      setError(err.message)
    }
    setBusyId(null)
  }

  return (
    <div className="page">
      <p>
        <Link to="/entities" className="link-button">
          ← Back to your books
        </Link>
      </p>
      <h1>Members</h1>
      <p className="page-subtitle">
        Manually activate or deactivate a comped/manual member's subscription, or schedule a real
        Stripe member's cancellation (per the 30-day email notice policy — this sets the
        cancellation in Stripe itself, so billing stays correct). This does not show any member's
        entities or transactions.
      </p>

      {error && <p className="form-error">{error}</p>}
      {rows === null && !error && <p>Loading…</p>}

      {rows && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Signed up</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Cancels</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sub = r.subscription
              const isStripe = sub?.provider === 'stripe' && sub?.provider_subscription_id
              return (
                <tr key={r.id}>
                  <td>
                    {r.email}
                    {r.is_admin ? ' (admin)' : ''}
                  </td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{sub?.status ?? 'none'}</td>
                  <td>{sub?.provider ?? '—'}</td>
                  <td>{sub?.cancel_at ? new Date(sub.cancel_at).toLocaleDateString() : '—'}</td>
                  <td>
                    {isStripe && sub?.status === 'active' ? (
                      sub.cancel_at ? (
                        <button
                          className="link-button"
                          disabled={busyId === r.id}
                          onClick={() => scheduleCancellation(r.id, 'undo')}
                        >
                          Undo cancellation
                        </button>
                      ) : (
                        <button
                          className="link-button"
                          disabled={busyId === r.id}
                          onClick={() => scheduleCancellation(r.id, 'schedule')}
                        >
                          Schedule cancellation
                        </button>
                      )
                    ) : sub?.status === 'active' ? (
                      <button
                        className="link-button"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, 'canceled')}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="link-button"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, 'active')}
                      >
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
