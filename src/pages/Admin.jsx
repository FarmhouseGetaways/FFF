import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import AdminKiosks from '../components/AdminKiosks.jsx'
import AdminUsage from '../components/AdminUsage.jsx'
import AdminPosRequests from '../components/AdminPosRequests.jsx'

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

/**
 * One member row.
 *
 * THE ACTION SET, decided 7 Sep 2026 - Cory: "Admin should not have a
 * deactivate or schedule cancellation. User accounts should have a schedule
 * cancellation and an archive." A platform admin's own row gets no actions at
 * all here - there is nothing on this screen an admin should be doing to
 * their own account. Every other live member gets exactly two: Schedule
 * cancellation (or Undo, once one is pending) and Archive. An archived
 * member instead gets Download and Reinstate - the only way back.
 */
function MemberRow({ r, busyId, archivedView, onDownload, onReinstate, onSchedule, onUndo, onArchive }) {
  const sub = r.subscription
  const pending = !!sub?.cancel_at
  return (
    <tr>
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
          {r.is_admin ? (
            <span className="cell-quiet">—</span>
          ) : archivedView ? (
            <>
              <button
                className="header-btn header-btn--sm"
                disabled={busyId === r.id}
                onClick={() => onDownload(r)}
              >
                Download
              </button>
              <button
                className="header-btn header-btn--sm"
                disabled={busyId === r.id}
                onClick={() => onReinstate(r.id)}
              >
                Reinstate
              </button>
            </>
          ) : (
            <>
              {pending ? (
                <button
                  className="header-btn header-btn--sm"
                  disabled={busyId === r.id}
                  onClick={() => onUndo(r.id)}
                >
                  Undo cancellation
                </button>
              ) : (
                <button
                  className="header-btn header-btn--sm"
                  disabled={busyId === r.id}
                  onClick={() => onSchedule(r.id)}
                >
                  Schedule cancellation
                </button>
              )}
              <button
                className="header-btn header-btn--sm header-btn--danger"
                disabled={busyId === r.id}
                onClick={() => onArchive(r.id)}
              >
                Archive
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
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

    /* Finalize any lapsed manual/comped cancellation. A real Stripe
       cancellation is enforced by Stripe itself and arrives back here through
       the webhook; a manual one has no such timer anywhere, since it never
       touches Stripe at all - see admin-schedule-cancellation.js. Loading
       this, the one screen that reads cancel_at, is the one reliable place to
       notice a date has passed and finish the job. */
    const now = Date.now()
    const lapsed = subs.filter(
      (s) => s.provider !== 'stripe' && s.status === 'active' && s.cancel_at && new Date(s.cancel_at).getTime() <= now
    )
    if (lapsed.length) {
      await Promise.all(
        lapsed.map((s) =>
          supabase
            .from('subscriptions')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('user_id', s.user_id)
        )
      )
      for (const s of lapsed) s.status = 'canceled'
    }

    const subsByUser = new Map(subs.map((s) => [s.user_id, s]))
    setRows(profiles.map((p) => ({ ...p, subscription: subsByUser.get(p.id) ?? null })))
  }

  useEffect(() => {
    load()
  }, [])

  async function setArchived(userId, archived) {
    setBusyId(userId)
    await supabase.from('profiles').update({ is_archived: archived }).eq('id', userId)
    if (!archived) {
      /* Reinstate undoes an Archive - and Cory never asked for that round
         trip to stop working (8 Sep 2026: "i never told you to remove it").
         A comped/manual member is fully ours to restore: no external biller
         to satisfy, so Reinstate puts them straight back to active, same as
         the old Activate button did. A real Stripe member who was Archived
         had their Stripe subscription actually DELETED, not just paused -
         there is no "un-delete" to ask Stripe for, so their local status
         stays whatever it is and they go through checkout again like any
         new signup. */
      const { data: rows } = await supabase
        .from('subscriptions')
        .select('provider')
        .eq('user_id', userId)
        .maybeSingle()
      if (rows && rows.provider !== 'stripe') {
        await supabase
          .from('subscriptions')
          .update({ status: 'active', cancel_at: null, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
      }
    }
    await load()
    setBusyId(null)
  }

  async function callAction(userId, action) {
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

  function schedule(userId) {
    if (
      !confirm(
        'Schedule this member’s cancellation? They’ll be canceled at the end of their current ' +
          'billing period, at least 30 days out — never cut off early, never billed an extra cycle ' +
          'beyond what the notice needs.'
      )
    ) {
      return
    }
    callAction(userId, 'schedule')
  }

  function archiveNow(userId) {
    if (
      !confirm(
        'Archive this member? This disables their account immediately — any active subscription is ' +
          'canceled right now, not at a future date — and moves them to the archived list.'
      )
    ) {
      return
    }
    callAction(userId, 'archive')
  }

  const [tab, setTab] = useState('kiosks')

  const visibleRows = rows ? rows.filter((r) => (showArchived ? r.is_archived : !r.is_archived)) : null

  return (
    <div className="page">
      <p>
        <Link to="/entities" className="header-btn">
          ← Back to your books
        </Link>
      </p>
      <h1>Admin</h1>
      <p className="page-subtitle">
        The platform's own view: every kiosk in the field, who is subscribed, and how much the
        accounting side is actually being used. Nobody but you sees this page.
      </p>

      {/* Four views of the same customers, not four pages: kiosks, accounts,
          how much they use it, and what they're asking for are questions
          you ask in one sitting. */}
      <div className="page-actions" style={{ marginBottom: '1.25rem' }}>
        {[
          ['kiosks', 'Customer kiosks'],
          ['members', 'Accounts'],
          ['usage', 'Usage'],
          ['requests', 'Requests'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={'header-btn' + (tab === key ? ' header-btn--on' : '')}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'kiosks' && <AdminKiosks />}
      {tab === 'usage' && <AdminUsage />}
      {tab === 'requests' && <AdminPosRequests />}

      {tab === 'members' && (<>
      <p className="page-subtitle">
        Schedule a member's cancellation (30 days' notice, aligned to the anniversary of when they
        went live with us so nobody's cut off mid-cycle or billed an extra one) or archive an
        account outright, which disables it immediately. This does not show any member's
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
            {visibleRows.map((r) => (
              <MemberRow
                key={r.id}
                r={r}
                busyId={busyId}
                archivedView={showArchived}
                onDownload={(row) => downloadCsv(`${row.email}.csv`, [row])}
                onReinstate={(id) => setArchived(id, false)}
                onSchedule={schedule}
                onUndo={(id) => callAction(id, 'undo')}
                onArchive={archiveNow}
              />
            ))}
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
      </>)}
    </div>
  )
}
