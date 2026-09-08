import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * Every "order another POS" request a customer has filed - see
 * EntitySettings.jsx (where it's submitted) and pos-request.mjs (where it's
 * filed and pushed to every admin's phone).
 *
 * Direct Supabase reads/writes, not a function - RLS on pos_requests already
 * lets an admin read and update every row (0010_pos_requests.sql), the same
 * pattern Admin.jsx already uses for profiles/subscriptions.
 */
function ago(iso) {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 90) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`
  return `${Math.round(secs / 86400)} d ago`
}

export default function AdminPosRequests() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [showDone, setShowDone] = useState(false)

  async function load() {
    setError('')
    // Two steps, not one embedded select: pos_requests.requested_by has a
    // real foreign key to auth.users, not to profiles, so PostgREST can't
    // embed a profiles row through it directly. The owner IS the requester
    // by construction of the insert policy, so entities.owner_id doubles as
    // the lookup key for their email.
    const { data, error } = await supabase
      .from('pos_requests')
      .select('id, location_name, shipping_address, notes, status, created_at, entities(name, owner_id)')
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
      return
    }
    const ownerIds = [...new Set((data || []).map((r) => r.entities?.owner_id).filter(Boolean))]
    let emailByOwner = {}
    if (ownerIds.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, email').in('id', ownerIds)
      emailByOwner = Object.fromEntries((profiles || []).map((p) => [p.id, p.email]))
    }
    setRows(data.map((r) => ({ ...r, ownerEmail: emailByOwner[r.entities?.owner_id] })))
  }

  useEffect(() => {
    load()
  }, [])

  async function setStatus(id, status) {
    setBusyId(id)
    await supabase.from('pos_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    await load()
    setBusyId(null)
  }

  if (error) return <p className="form-error">{error}</p>
  if (!rows) return <p>Loading…</p>

  const visible = rows.filter((r) => (showDone ? r.status !== 'open' : r.status === 'open'))

  return (
    <>
      <p className="page-subtitle">
        Every request lands here and pushes your phone the moment it's filed. Nothing about a
        stand is provisioned automatically &mdash; follow up on payment and shipping, then
        provision it in mbm-checkout the same as any stand, and mark it done here.
      </p>

      <div className="page-actions" style={{ marginBottom: '1rem' }}>
        <button className="header-btn" onClick={() => setShowDone((v) => !v)}>
          {showDone ? '← Back to open requests' : 'View fulfilled/declined'}
        </button>
      </div>

      <div className="table-scroll">
        <table className="data-table admin-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Wants it called</th>
              <th>Requested</th>
              <th>Shipping / notes</th>
              {!showDone && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td data-label="Business">
                  <b>{r.entities?.name || '—'}</b>
                  <div className="cell-sub">{r.ownerEmail || '—'}</div>
                </td>
                <td data-label="Wants it called">{r.location_name}</td>
                <td data-label="Requested">{ago(r.created_at)}</td>
                <td data-label="Shipping / notes" className="cell-sub">
                  {r.shipping_address && <div>{r.shipping_address}</div>}
                  {r.notes && <div>{r.notes}</div>}
                  {!r.shipping_address && !r.notes && '—'}
                </td>
                {!showDone && (
                  <td>
                    <div className="row-actions">
                      <button
                        className="header-btn header-btn--sm"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, 'fulfilled')}
                      >
                        Mark fulfilled
                      </button>
                      <button
                        className="header-btn header-btn--sm header-btn--danger"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, 'declined')}
                      >
                        Decline
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="empty-state">
                  {showDone ? 'Nothing here yet.' : 'No open requests.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
