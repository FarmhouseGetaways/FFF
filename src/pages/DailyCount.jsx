import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, todayISO } from '../lib/money'

// What was ordered against what sold, closed out once a day (14 Sep 2026).
// From a tester's spreadsheet routine: put in what you ordered, count what
// sold at close, see the day's profit and loss.
//
// Saving goes through save_daily_count (migration 0011) so the count and
// what it posts to the ledger land together or not at all. Sales always
// post, into the account picked here (Cory: "Automatically"). What was paid
// for the order posts only if the box is ticked - someone who already
// enters vendor bills in Transactions would otherwise count it twice.
// Either way the page itself shows the full day: sales less the wholesale
// cost of everything ordered, sold or not.

let nextKey = 1
const blankLine = () => ({ key: nextKey++, product_id: null, product_name: '', vendor: null, price: 0, cost: null, ordered: '', sold: '' })

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0)

function lineTotals(l) {
  const sales = num(l.sold) * num(l.price)
  const cost = num(l.ordered) * num(l.cost)
  return { sales, cost, profit: sales - cost }
}

function sumLines(lines) {
  return lines.reduce(
    (t, l) => {
      const x = lineTotals(l)
      return { sales: t.sales + x.sales, cost: t.cost + x.cost, profit: t.profit + x.profit }
    },
    { sales: 0, cost: 0, profit: 0 }
  )
}

function storageGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private window etc. - the default just isn't remembered */
  }
}

export default function DailyCount() {
  const { entityId } = useOutletContext()
  const [products, setProducts] = useState(null)
  const [accounts, setAccounts] = useState(null)
  const [date, setDate] = useState(todayISO())
  const [saved, setSaved] = useState(false)
  const [prefillFrom, setPrefillFrom] = useState(null)
  const [lines, setLines] = useState(null)
  const [accountId, setAccountId] = useState('')
  const [recordCost, setRecordCost] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [history, setHistory] = useState(null)
  const [ytd, setYtd] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const accountKey = `dailyCount.account.${entityId}`
  const costKey = `dailyCount.recordCost.${entityId}`
  // Only the latest day asked for may fill the table - clicking through days
  // quickly would otherwise let a slower, older answer land last.
  const dayRequest = useRef(0)

  useEffect(() => {
    let active = true
    setProducts(null)
    setAccounts(null)
    Promise.all([
      supabase
        .from('products')
        .select('id, name, vendor, price, cost, is_archived')
        .eq('entity_id', entityId)
        .order('name'),
      supabase
        .from('financial_accounts')
        .select('id, name, account_type')
        .eq('entity_id', entityId)
        .eq('is_archived', false)
        .order('name'),
    ]).then(([p, a]) => {
      if (!active) return
      if (p.error || a.error) setError((p.error || a.error).message)
      setProducts(p.data ?? [])
      setAccounts(a.data ?? [])
    })
    return () => {
      active = false
    }
  }, [entityId])

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])

  // Active products grouped by vendor for the item dropdown; no vendor last.
  const productGroups = useMemo(() => {
    const groups = new Map()
    for (const p of products ?? []) {
      if (p.is_archived) continue
      const g = p.vendor || ''
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(p)
    }
    return [...groups.entries()].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b))
  }, [products])

  // With an empty catalog there is nothing to pick from, so a fresh line
  // starts as a typed-in one rather than a dropdown that can't be used.
  const newLine = () => ({ ...blankLine(), typed: (products ?? []).length === 0 })

  async function loadHistory() {
    const { data, error } = await supabase
      .from('daily_closeouts')
      .select('close_date, lines:daily_count_lines(ordered, sold, price, cost)')
      .eq('entity_id', entityId)
      .order('close_date', { ascending: false })
      .limit(30)
    if (error) setError(error.message)
    else setHistory(data)
  }

  // Everything counted since 1 January, for the running total at the bottom
  // of the page (Cory, 16 Sep 2026).
  async function loadYtd() {
    const jan1 = `${new Date().getFullYear()}-01-01`
    const { data, error } = await supabase
      .from('daily_closeouts')
      .select('close_date, lines:daily_count_lines(ordered, sold, price, cost)')
      .eq('entity_id', entityId)
      .gte('close_date', jan1)
    if (error) return
    const lines = data.flatMap((d) => d.lines)
    setYtd({ days: data.length, ...sumLines(lines) })
  }

  async function loadDay(forDate) {
    const req = ++dayRequest.current
    setLines(null)
    setPrefillFrom(null)
    setDirty(false)
    const { data, error } = await supabase
      .from('daily_closeouts')
      .select('close_date, financial_account_id, record_order_cost, lines:daily_count_lines(product_id, product_name, vendor, ordered, sold, price, cost, sort_order)')
      .eq('entity_id', entityId)
      .eq('close_date', forDate)
      .maybeSingle()
    if (req !== dayRequest.current) return
    if (error) {
      setError(error.message)
      setLines([newLine()])
      return
    }

    const rememberedAccount = storageGet(accountKey)
    const fallbackAccount =
      (accounts.find((a) => a.id === rememberedAccount) ||
        accounts.find((a) => a.account_type === 'cash') ||
        accounts[0])?.id || ''

    if (data) {
      setSaved(true)
      setAccountId(accounts.some((a) => a.id === data.financial_account_id) ? data.financial_account_id : fallbackAccount)
      setRecordCost(data.record_order_cost)
      const sorted = [...data.lines].sort((a, b) => a.sort_order - b.sort_order)
      setLines(
        sorted.length
          ? sorted.map((l) => ({
              ...l,
              key: nextKey++,
              typed: !l.product_id,
              ordered: String(Number(l.ordered)),
              sold: String(Number(l.sold)),
            }))
          : [newLine()]
      )
      return
    }

    setSaved(false)
    setAccountId(fallbackAccount)
    setRecordCost(storageGet(costKey) === '1')

    // A new day starts from the last day's item list with the counts blank,
    // at today's prices.
    const { data: prev } = await supabase
      .from('daily_closeouts')
      .select('close_date, lines:daily_count_lines(product_id, product_name, vendor, price, cost, sort_order)')
      .eq('entity_id', entityId)
      .lt('close_date', forDate)
      .order('close_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (req !== dayRequest.current) return
    const prevLines = [...(prev?.lines ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((l) => !l.product_id || !productById.get(l.product_id)?.is_archived)
    if (prevLines.length) {
      setPrefillFrom(prev.close_date)
      setLines(
        prevLines.map((l) => {
          const p = l.product_id ? productById.get(l.product_id) : null
          return {
            key: nextKey++,
            product_id: l.product_id,
            product_name: p?.name ?? l.product_name,
            vendor: p ? p.vendor : l.vendor,
            price: p ? p.price : l.price,
            cost: p ? p.cost : l.cost,
            ordered: '',
            sold: '',
          }
        })
      )
    } else {
      setLines([newLine()])
    }
  }

  useEffect(() => {
    if (products === null || accounts === null) return
    setNotice('')
    setError('')
    loadDay(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, date, products, accounts])

  useEffect(() => {
    loadHistory()
    loadYtd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  function changeDate(next) {
    if (!next || next === date) return
    if (dirty && !confirm('Leave this day without saving your numbers?')) return
    setDate(next)
  }

  function updateLine(key, patch) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setDirty(true)
    setNotice('')
  }

  function chooseProduct(key, productId) {
    if (productId === '__typed')
      return updateLine(key, { typed: true, product_id: null, product_name: '', vendor: null, price: 0, cost: null })
    const p = productById.get(productId)
    if (!p) return updateLine(key, { typed: false, product_id: null, product_name: '', vendor: null, price: 0, cost: null })
    updateLine(key, { typed: false, product_id: p.id, product_name: p.name, vendor: p.vendor, price: p.price, cost: p.cost })
  }

  function removeLine(key) {
    setLines((ls) => {
      const rest = ls.filter((l) => l.key !== key)
      return rest.length ? rest : [newLine()]
    })
    setDirty(true)
    setNotice('')
  }

  function addLine() {
    // With nothing in the catalog there is nothing to pick from, so a new
    // line starts ready to be typed into.
    setLines((ls) => [...ls, newLine()])
  }

  const filled = (lines ?? []).filter((l) => l.product_name)
  const totals = sumLines(filled)
  const noWholesale = filled.filter((l) => l.cost == null && num(l.ordered) > 0).map((l) => l.product_name)

  async function handleSave() {
    setError('')
    setNotice('')
    if (!filled.length) {
      // Numbers typed into a row whose item was never chosen is the quiet
      // way a whole day comes to nothing - say which half is missing.
      const hasNumbers = (lines ?? []).some((l) => l.ordered !== '' || l.sold !== '')
      setError(
        hasNumbers
          ? 'Pick an item on the row you filled in — or choose "Type in an item…" and give it a name — then save.'
          : 'Add an item before saving.'
      )
      return
    }
    // Saving reloads the day from the database, which would throw away a
    // row that has numbers in it but no item chosen yet - easy to hit now
    // that Save sits in every row. Those rows are put back afterwards.
    const pending = (lines ?? []).filter((l) => !l.product_name && (l.ordered !== '' || l.sold !== ''))
    setBusy(true)
    const { error } = await supabase.rpc('save_daily_count', {
      p_entity: entityId,
      p_date: date,
      p_account: accountId || null,
      p_record_cost: recordCost,
      p_lines: filled.map((l, i) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        vendor: l.vendor,
        ordered: num(l.ordered),
        sold: num(l.sold),
        price: num(l.price),
        cost: l.cost == null ? null : Number(l.cost),
        sort_order: i,
      })),
    })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    if (accountId) storageSet(accountKey, accountId)
    storageSet(costKey, recordCost ? '1' : '0')
    const posted = []
    if (accountId && totals.sales > 0) posted.push(`${formatMoney(totals.sales)} in sales`)
    if (accountId && recordCost && totals.cost > 0) posted.push(`${formatMoney(totals.cost)} paid for the order`)
    const accountName = accounts.find((a) => a.id === accountId)?.name
    await loadDay(date)
    if (pending.length) setLines((ls) => [...(ls ?? []), ...pending])
    loadHistory()
    loadYtd()
    setNotice(
      posted.length
        ? `Closed out ${prettyDate(date)}. ${posted.join(' and ')} recorded in Transactions under ${accountName}.`
        : accounts.length === 0 && totals.sales > 0
          ? `Closed out ${prettyDate(date)}. Saved here only — add an account and these sales will go into your books too.`
          : `Closed out ${prettyDate(date)}.`
    )
  }

  async function handleDelete() {
    if (!confirm(`Delete the count for ${prettyDate(date)}? What it recorded in Transactions is removed too.`)) return
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('delete_daily_count', { p_entity: entityId, p_date: date })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    await loadDay(date)
    loadHistory()
    loadYtd()
    setNotice(`Deleted the count for ${prettyDate(date)}.`)
  }

  const loading = products === null || accounts === null || lines === null
  const isToday = date === todayISO()

  const cards = [
    { label: 'Sales', value: totals.sales, note: 'Sold × selling price.', tone: 'in' },
    { label: 'Cost of what you ordered', value: totals.cost, note: 'Ordered × wholesale price.', tone: 'out' },
    {
      label: 'Profit for the day',
      value: totals.profit,
      note: 'Sales minus the cost of what you ordered.',
      tone: totals.profit > 0 ? 'in' : totals.profit < 0 ? 'out' : 'neutral',
    },
  ]

  return (
    <div className="page page--wide">
      <h1>The Numbers</h1>
      <p className="page-subtitle">
        Put in what you ordered, count what sold at close, and see the day&apos;s profit.
      </p>

      <div className="date-range count-date">
        <button type="button" className="header-btn" onClick={() => changeDate(shiftDate(date, -1))}>
          ← Previous day
        </button>
        <label>
          Day
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
        </label>
        <button type="button" className="header-btn" onClick={() => changeDate(shiftDate(date, 1))}>
          Next day →
        </button>
        {!isToday && (
          <button type="button" className="header-btn" onClick={() => changeDate(todayISO())}>
            Today
          </button>
        )}
      </div>

      {loading && !error && <p>Loading…</p>}

      {!loading && products.filter((p) => !p.is_archived).length === 0 && (
        <p className="form-info">
          No items yet. Add what you sell in <Link to="../inventory">Inventory</Link> first.
        </p>
      )}

      {!loading && (
        <>
          <div className="summary-grid summary-grid--three">
            {cards.map((c) => (
              <div className={'summary-card summary-card--' + c.tone} key={c.label}>
                <span className="summary-label">{c.label}</span>
                <strong className="summary-value">{formatMoney(c.value)}</strong>
                <span className="summary-note">{c.note}</span>
              </div>
            ))}
          </div>

          <h2 className="count-heading">
            {prettyDate(date)}
            <span className={'count-status' + (saved ? ' count-status--saved' : '')}>
              {saved ? (dirty ? 'Closed out · unsaved changes' : 'Closed out') : 'Not closed out'}
            </span>
          </h2>
          {prefillFrom && (
            <p className="page-subtitle count-prefill">Items from your count on {prettyDate(prefillFrom)}.</p>
          )}

          <div className="table-scroll">
            <table className="data-table count-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Wholesale</th>
                  <th className="num">Price</th>
                  <th className="num">Ordered</th>
                  <th className="num">Sold</th>
                  <th className="num">Left over</th>
                  <th className="num">Sales</th>
                  <th className="num">Profit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const t = lineTotals(l)
                  const left = num(l.ordered) - num(l.sold)
                  const listed = l.product_id && productGroups.some(([, ps]) => ps.some((p) => p.id === l.product_id))
                  return (
                    <tr key={l.key}>
                      <td>
                        {l.typed ? (
                          <div className="count-typed">
                            <input
                              value={l.product_name}
                              onChange={(e) => updateLine(l.key, { product_name: e.target.value })}
                              placeholder="What is it?"
                              aria-label="Item"
                            />
                            {products.length > 0 && (
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => updateLine(l.key, { typed: false, product_name: '', price: 0, cost: null })}
                              >
                                Pick from my list
                              </button>
                            )}
                          </div>
                        ) : (
                        <select
                          value={l.product_id || ''}
                          onChange={(e) => chooseProduct(l.key, e.target.value)}
                          aria-label="Item"
                        >
                          <option value="">{!l.product_id && l.product_name ? l.product_name : 'Choose an item'}</option>
                          {l.product_id && !listed && <option value={l.product_id}>{l.product_name}</option>}
                          {productGroups.map(([vendor, ps]) =>
                            vendor ? (
                              <optgroup key={vendor} label={vendor}>
                                {ps.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </optgroup>
                            ) : (
                              <optgroup key="no-vendor" label={productGroups.length > 1 ? 'No vendor' : 'Items'}>
                                {ps.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </optgroup>
                            )
                          )}
                          {/* A count shouldn't need the catalog filled in
                              first - anything at the stand can be typed. */}
                          <option value="__typed">Type in an item…</option>
                        </select>
                        )}
                      </td>
                      <td className="num">
                        {l.typed ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={l.cost ?? ''}
                            onChange={(e) => updateLine(l.key, { cost: e.target.value === '' ? null : Number(e.target.value) })}
                            aria-label="Wholesale price"
                          />
                        ) : l.product_name ? (
                          l.cost != null ? (
                            formatMoney(l.cost)
                          ) : (
                            '—'
                          )
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="num">
                        {l.typed ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={l.price || ''}
                            onChange={(e) => updateLine(l.key, { price: e.target.value === '' ? 0 : Number(e.target.value) })}
                            aria-label="Selling price"
                          />
                        ) : l.product_name ? (
                          formatMoney(l.price)
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={l.ordered}
                          onChange={(e) => updateLine(l.key, { ordered: e.target.value })}
                          aria-label="Ordered"
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={l.sold}
                          onChange={(e) => updateLine(l.key, { sold: e.target.value })}
                          aria-label="Sold"
                        />
                      </td>
                      <td className={'num' + (left < 0 ? ' negative' : '')}>{l.product_name ? left : ''}</td>
                      <td className="num">{l.product_name ? formatMoney(t.sales) : ''}</td>
                      <td className={'num' + (t.profit < 0 ? ' negative' : '')}>{l.product_name ? formatMoney(t.profit) : ''}</td>
                      {/* Save sits next to the numbers being typed, before
                          Remove (Cory, 16 Sep 2026). It saves the whole day,
                          same as the button at the bottom - there is one
                          count per day, not one per line. */}
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="header-btn header-btn--sm header-btn--primary"
                            onClick={handleSave}
                            disabled={busy || !dirty}
                          >
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="header-btn header-btn--sm header-btn--danger"
                            onClick={() => removeLine(l.key)}
                            aria-label="Remove item"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>Day total</td>
                  <td className="num">{formatMoney(totals.sales)}</td>
                  <td className={'num' + (totals.profit < 0 ? ' negative' : '')}>{formatMoney(totals.profit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="page-actions count-add">
            <button type="button" className="header-btn" onClick={addLine}>
              + Add item
            </button>
          </div>

          {/* Saving can now happen from a row, so what came of it has to be
              visible here and not only down by the close-out form. */}
          {notice && <p className="form-notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}

          {noWholesale.length > 0 && (
            <p className="form-info">
              No wholesale price for {noWholesale.join(', ')}, so it counts as $0 cost. Add it in{' '}
              <Link to="../inventory">Inventory</Link>.
            </p>
          )}

          <div className="inline-form">
            <h2>Close out {prettyDate(date)}</h2>
            {accounts.length === 0 ? (
              // The count is worth keeping whether or not there's anywhere
              // to post it - it used to refuse to save at all (Cory, 16 Sep
              // 2026: "Not saving entries"), which threw the day away.
              <p className="form-info">
                Your numbers save here either way. Add an account and the day&apos;s sales will also go into your
                books. <Link to="../accounts">Accounts</Link>
              </p>
            ) : (
              <>
                <div className="form-row">
                  <label>
                    Sales go into
                    <select
                      value={accountId}
                      onChange={(e) => {
                        setAccountId(e.target.value)
                        setDirty(true)
                      }}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="count-check">
                  <input
                    type="checkbox"
                    checked={recordCost}
                    onChange={(e) => {
                      setRecordCost(e.target.checked)
                      setDirty(true)
                    }}
                  />
                  <span>
                    Also record what I paid for this order ({formatMoney(totals.cost)}) from this account
                    <small>Leave off if you enter vendor bills in Transactions.</small>
                  </span>
                </label>
              </>
            )}
            <div className="form-row">
              {/* Nothing to save until something changes - a live Save on an
                  untouched day invites a click that does nothing. */}
              <button type="submit" onClick={handleSave} disabled={busy || !dirty}>
                {busy ? 'Saving…' : saved ? (dirty ? 'Save changes' : 'Saved') : 'Close out the day'}
              </button>
              {saved && (
                <button type="button" className="header-btn header-btn--danger" onClick={handleDelete} disabled={busy}>
                  Delete this day
                </button>
              )}
            </div>
            {/* The same messages show under the table, next to the row's own
                Save - one copy each, whichever button was used. */}
          </div>

          <h2 className="count-heading count-heading--history">Year to date</h2>
          <p className="page-subtitle">
            Every day you have closed out since 1 January {new Date().getFullYear()}.
          </p>
          <div className="summary-grid summary-grid--three">
            <div className="summary-card summary-card--in">
              <span className="summary-label">Sales</span>
              <strong className="summary-value">{formatMoney(ytd?.sales ?? 0)}</strong>
              <span className="summary-note">
                Across {ytd?.days ?? 0} day{(ytd?.days ?? 0) === 1 ? '' : 's'} counted.
              </span>
            </div>
            <div className="summary-card summary-card--out">
              <span className="summary-label">Cost of what you ordered</span>
              <strong className="summary-value">{formatMoney(ytd?.cost ?? 0)}</strong>
              <span className="summary-note">Wholesale cost of everything put out.</span>
            </div>
            <div className={'summary-card summary-card--' + ((ytd?.profit ?? 0) >= 0 ? 'in' : 'out')}>
              <span className="summary-label">Profit</span>
              <strong className="summary-value">{formatMoney(ytd?.profit ?? 0)}</strong>
              <span className="summary-note">Sales minus what the stock cost you.</span>
            </div>
          </div>

          <h2 className="count-heading count-heading--history">Recent days</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Sales</th>
                  <th className="num">Cost of what you ordered</th>
                  <th className="num">Profit</th>
                </tr>
              </thead>
              <tbody>
                {(history ?? []).map((h) => {
                  const t = sumLines(h.lines)
                  return (
                    <tr key={h.close_date} className={h.close_date === date ? 'count-current' : ''}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => changeDate(h.close_date)}>
                          {prettyDate(h.close_date)}
                        </button>
                      </td>
                      <td className="num">{formatMoney(t.sales)}</td>
                      <td className="num">{formatMoney(t.cost)}</td>
                      <td className={'num' + (t.profit < 0 ? ' negative' : '')}>{formatMoney(t.profit)}</td>
                    </tr>
                  )
                })}
                {history && history.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      No days closed out yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {loading && error && <p className="form-error">{error}</p>}
    </div>
  )
}
