import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { openPos } from '../lib/posHandoff.js'

/**
 * Every kiosk in the field, ours included, with a way into each one.
 *
 * The Edit button is the whole point: it hands you into THAT stand's admin,
 * signed in, so a concierge setup — someone's idle screen, their checkout
 * wording, their payment handles, their catalog — is done in the same screens
 * the owner would use rather than in a separate god-mode that would then have
 * to be kept in step with them.
 */
function ago(iso) {
  if (!iso) return 'never'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 90) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`
  return `${Math.round(secs / 86400)} d ago`
}

const STATUS = {
  up: { label: 'Live', className: 'kiosk-dot kiosk-dot--up' },
  down: { label: 'Not reporting', className: 'kiosk-dot kiosk-dot--down' },
  never: { label: 'Never checked in', className: 'kiosk-dot kiosk-dot--never' },
}

export default function AdminKiosks() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

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

  if (!data.standsReachable) {
    return (
      <p className="form-notice">
        Could not reach the checkout site, so the kiosk list is unavailable. Everything else on
        this page still works.
      </p>
    )
  }

  if (!data.stands.length) {
    return <p className="empty-state">No stands are registered yet.</p>
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Stand</th>
            <th>Business</th>
            <th>Status</th>
            <th>Last seen</th>
            <th>Takes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.stands.map((s) => {
            const st = STATUS[s.status] || STATUS.never
            const takes = s.cardReady
              ? 'Card + digital'
              : (s.payMethods?.length ? `Digital (${s.payMethods.join(', ')})` : 'Cash only')
            return (
              <tr key={s.slug}>
                <td>
                  <b>{s.name}</b>
                  <div className="cell-sub">{s.ownerEmail || '—'}</div>
                </td>
                <td>{s.businessName || <span className="cell-sub">not linked</span>}</td>
                <td><span className={st.className} /> {st.label}</td>
                <td>{ago(s.lastBeatAt)}</td>
                <td>{takes}</td>
                <td>
                  <div className="row-actions">
                    {/* Straight into their stand's admin, signed in - the same
                        settings screens the owner sees. */}
                    <button
                      className="header-btn header-btn--sm"
                      disabled={!s.entityId}
                      title={s.entityId ? 'Open this stand’s settings' : 'This stand is not linked to a business'}
                      onClick={() => openPos(s.entityId)}
                    >
                      Edit ↗
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
