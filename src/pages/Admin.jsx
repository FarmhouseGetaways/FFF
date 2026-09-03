import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv(filename, rows) {
  const header = ['Email', 'Signed up', 'Status', 'Provider', 'Cancels']
  const lines = [header.join(',')]
  for (const r of rows) {
    const sub = r.subscription
    lines.push(
      [
        r.email,
        new Date(r.created_at).toLocaleDateString(),
        sub?.status ?? 'none',
        sub?.provider ?? '',
        sub?.cancel_at ? new Date(sub.cancel_at).toLocaleDateString() : '',
      ]
        .map(csvCell)
        .join(',')
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function Admin() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  // A browser download gives no feedback of its own - say where the file went.
  const [notice, setNotice] = useState('')

  async function load() {
    setError('')
    const [{ data: profiles, error: pErr }, { data: subs, error: sErr }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, created_at, is_admin, is_archived').order('created_at'),
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

  async function setArchived(userId, archived) {
    setBusyId(userId)
    await supabase.from('profiles').update({ is_archived: archived }).eq('id', userId)
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

  const visibleRows = rows ? rows.filter((r) => (showArchived ? r.is_archived : !r.is_archived)) : null

  return (
    <div className="page">
      <p>
        <Link to="/entities" className="header-btn">
          ← Back to your books
        </Link>
      </p>
      <h1>Members</h1>
      <p className="page-subtitle">
        Manually activate or deactivate a comped/manual member's subscription, or schedule a real
        Stripe member's cancellation (per the 30-day email notice policy — this sets the
        cancellation in Stripe itself, so billing stays correct). This does not show any member's
        businesses or transactions.
      </p>

      {/* Same pill-button action row as the entity list - see .page-actions
          in styles.css. A page-level action shouldn't look like one thing
          here and another thing there. */}
      <div className="page-actions">
        <button className="header-btn" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? '← Back to active members' : 'View archived members'}
        </button>
        {!showArchived && visibleRows && visibleRows.length > 0 && (
          <button
            className="header-btn"
            onClick={() => {
              downloadCsv('members.csv', visibleRows)
              setNotice('CSV downloaded — check your browser’s Downloads folder for members.csv.')
            }}
          >
            Download CSV
          </button>
        )}
      </div>

      {notice && <p className="form-notice">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {rows === null && !error && <p>Loading…</p>}

      {visibleRows && (
        <div className="table-scroll">
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
            {visibleRows.map((r) => {
              const sub = r.subscription
              const isStripe = sub?.provider === 'stripe' && sub?.provider_subscription_id
              const isActive = sub?.status === 'active'
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
                    <div className="row-actions">
                      {showArchived ? (
                        <>
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => downloadCsv(`${r.email}.csv`, [r])}
                          >
                            Download
                          </button>
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => setArchived(r.id, false)}
                          >
                            Reinstate
                          </button>
                        </>
                      ) : isStripe && isActive ? (
                        sub.cancel_at ? (
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => scheduleCancellation(r.id, 'undo')}
                          >
                            Undo cancellation
                          </button>
                        ) : (
                          <button
                            className="header-btn header-btn--sm header-btn--danger"
                            disabled={busyId === r.id}
                            onClick={() => scheduleCancellation(r.id, 'schedule')}
                          >
                            Schedule cancellation
                          </button>
                        )
                      ) : isActive ? (
                        <button
                          className="header-btn header-btn--sm header-btn--danger"
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r.id, 'canceled')}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <>
                          <button
                            className="header-btn header-btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => setStatus(r.id, 'active')}
                          >
                            Activate
                          </button>
                          <button
                            className="header-btn header-btn--sm header-btn--danger"
                            disabled={busyId === r.id}
                            onClick={() => setArchived(r.id, true)}
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  {showArchived ? 'No archived members.' : 'No members yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
