import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/money'
import { guessCategory, guessColumns, parseAmount, parseDate } from '../lib/csvImport'

export default function ImportCsv() {
  const { entityId } = useOutletContext()
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [accountId, setAccountId] = useState('')
  const [source, setSource] = useState('csv_import') // 'csv_import' | 'venmo_csv'

  const [headers, setHeaders] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [columns, setColumns] = useState({
    dateField: '',
    descriptionField: '',
    amountField: '',
    debitField: '',
    creditField: '',
    useDebitCredit: false,
  })

  const [defaultIncomeCategory, setDefaultIncomeCategory] = useState('')
  const [defaultExpenseCategory, setDefaultExpenseCategory] = useState('')
  const [rowOverrides, setRowOverrides] = useState({}) // index -> { include?, categoryId? }
  const [existingKeys, setExistingKeys] = useState(new Set())

  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase
        .from('financial_accounts')
        .select('id, name')
        .eq('entity_id', entityId)
        .eq('is_archived', false)
        .order('name'),
      supabase
        .from('categories')
        .select('id, name, category_type')
        .eq('entity_id', entityId)
        .eq('is_archived', false)
        .order('name'),
    ]).then(([{ data: accts }, { data: cats }]) => {
      setAccounts(accts ?? [])
      setCategories(cats ?? [])
      setDefaultIncomeCategory(cats?.find((c) => c.category_type === 'income')?.id ?? '')
      setDefaultExpenseCategory(cats?.find((c) => c.category_type === 'expense')?.id ?? '')
    })
  }, [entityId])

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setInfo('')
    setRowOverrides({})
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fields = results.meta.fields ?? []
        setHeaders(fields)
        setRawRows(results.data)
        setColumns((prev) => ({ ...prev, ...guessColumns(fields) }))
      },
      error: (err) => setError(err.message),
    })
  }

  // Parsed, typed rows before category assignment.
  const parsedRows = useMemo(() => {
    if (!columns.dateField || !columns.descriptionField) return []
    if (!columns.useDebitCredit && !columns.amountField) return []
    if (columns.useDebitCredit && !columns.debitField && !columns.creditField) return []

    return rawRows
      .map((raw) => {
        const date = parseDate(raw[columns.dateField])
        const description = (raw[columns.descriptionField] ?? '').trim()
        let amount
        if (columns.useDebitCredit) {
          const debit = parseAmount(raw[columns.debitField]) ?? 0
          const credit = parseAmount(raw[columns.creditField]) ?? 0
          amount = credit - Math.abs(debit)
        } else {
          amount = parseAmount(raw[columns.amountField])
        }
        return { date, description, amount }
      })
      .filter((r) => r.date && r.description && r.amount !== null && r.amount !== 0)
  }, [rawRows, columns])

  // Look up existing transactions on this account in the imported date range
  // so obvious re-imports get flagged instead of silently duplicated.
  useEffect(() => {
    if (!accountId || parsedRows.length === 0) {
      setExistingKeys(new Set())
      return
    }
    const dates = parsedRows.map((r) => r.date)
    const minDate = dates.reduce((a, b) => (b < a ? b : a))
    const maxDate = dates.reduce((a, b) => (b > a ? b : a))
    supabase
      .from('transactions')
      .select('txn_date, amount')
      .eq('financial_account_id', accountId)
      .gte('txn_date', minDate)
      .lte('txn_date', maxDate)
      .then(({ data }) => {
        setExistingKeys(new Set((data ?? []).map((t) => `${t.txn_date}|${Number(t.amount).toFixed(2)}`)))
      })
  }, [accountId, parsedRows])

  const previewRows = useMemo(() => {
    return parsedRows.map((row, index) => {
      const categoryType = row.amount >= 0 ? 'income' : 'expense'
      const guessedId = guessCategory(row.description, categories, categoryType)
      const fallbackId = categoryType === 'income' ? defaultIncomeCategory : defaultExpenseCategory
      const isDuplicate = existingKeys.has(`${row.date}|${row.amount.toFixed(2)}`)
      const override = rowOverrides[index] ?? {}
      return {
        ...row,
        categoryType,
        categoryId: override.categoryId ?? guessedId ?? fallbackId,
        wasGuessed: Boolean(guessedId),
        isDuplicate,
        include: override.include ?? !isDuplicate,
      }
    })
  }, [parsedRows, categories, defaultIncomeCategory, defaultExpenseCategory, existingKeys, rowOverrides])

  function setRowOverride(index, patch) {
    setRowOverrides((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }))
  }

  async function handleImport() {
    if (!accountId) {
      setError('Choose which account this statement is for.')
      return
    }
    const toImport = previewRows.filter((r) => r.include)
    if (toImport.length === 0) {
      setError('Nothing selected to import.')
      return
    }
    if (toImport.some((r) => !r.categoryId)) {
      setError('Every included row needs a category — pick default categories above or set one per row.')
      return
    }
    setBusy(true)
    setError('')
    const { error } = await supabase.from('transactions').insert(
      toImport.map((r) => ({
        entity_id: entityId,
        financial_account_id: accountId,
        category_id: r.categoryId,
        txn_date: r.date,
        description: r.description,
        amount: r.amount,
        source,
      }))
    )
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setInfo(`Imported ${toImport.length} transaction${toImport.length === 1 ? '' : 's'}.`)
    setRawRows([])
    setHeaders([])
    setRowOverrides({})
  }

  const includedCount = previewRows.filter((r) => r.include).length

  return (
    <div className="page">
      <h1>Import transactions</h1>
      <p className="page-subtitle">
        Upload a bank or Venmo CSV export. Columns and categories are auto-detected — review before
        importing.
      </p>

      <div className="inline-form">
        <div className="form-row">
          <label>
            Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="" disabled>
                Select…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="csv_import">Bank statement</option>
              <option value="venmo_csv">Venmo</option>
            </select>
          </label>
          <label className="grow">
            CSV file
            <input type="file" accept=".csv,text/csv" onChange={handleFile} />
          </label>
        </div>
      </div>

      {headers.length > 0 && (
        <div className="inline-form">
          <h2>Which columns are which?</h2>
          <div className="form-row">
            <label>
              Date column
              <select
                value={columns.dateField}
                onChange={(e) => setColumns((c) => ({ ...c, dateField: e.target.value }))}
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description column
              <select
                value={columns.descriptionField}
                onChange={(e) => setColumns((c) => ({ ...c, descriptionField: e.target.value }))}
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={columns.useDebitCredit}
                  onChange={(e) => setColumns((c) => ({ ...c, useDebitCredit: e.target.checked }))}
                />
                Separate debit/credit columns
              </span>
            </label>
            {columns.useDebitCredit ? (
              <>
                <label>
                  Debit column
                  <select
                    value={columns.debitField}
                    onChange={(e) => setColumns((c) => ({ ...c, debitField: e.target.value }))}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Credit column
                  <select
                    value={columns.creditField}
                    onChange={(e) => setColumns((c) => ({ ...c, creditField: e.target.value }))}
                  >
                    <option value="">None</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label>
                Amount column
                <select
                  value={columns.amountField}
                  onChange={(e) => setColumns((c) => ({ ...c, amountField: e.target.value }))}
                >
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="form-row" style={{ marginTop: '1rem' }}>
            <label>
              Default income category
              <select value={defaultIncomeCategory} onChange={(e) => setDefaultIncomeCategory(e.target.value)}>
                <option value="">None</option>
                {categories
                  .filter((c) => c.category_type === 'income')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Default expense category
              <select value={defaultExpenseCategory} onChange={(e) => setDefaultExpenseCategory(e.target.value)}>
                <option value="">None</option>
                {categories
                  .filter((c) => c.category_type === 'expense')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {previewRows.length > 0 && (
        <>
          <table className="data-table" style={{ marginTop: '1.5rem' }}>
            <thead>
              <tr>
                <th />
                <th>Date</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, index) => (
                <tr key={index} style={{ opacity: row.include ? 1 : 0.5 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => setRowOverride(index, { include: e.target.checked })}
                    />
                  </td>
                  <td>
                    {row.date}
                    {row.isDuplicate && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--red)' }}>possible duplicate</div>
                    )}
                  </td>
                  <td>{row.description}</td>
                  <td className={'num' + (row.amount < 0 ? ' negative' : ' positive')}>
                    {formatMoney(row.amount)}
                  </td>
                  <td>
                    <select
                      value={row.categoryId || ''}
                      onChange={(e) => setRowOverride(index, { categoryId: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {categories
                        .filter((c) => c.category_type === row.categoryType)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="inline-form" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {includedCount} of {previewRows.length} rows selected
            </span>
            <button type="button" className="btn-primary" onClick={handleImport} disabled={busy}>
              {busy ? 'Importing…' : `Import ${includedCount} transaction${includedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}

      {error && <p className="form-error">{error}</p>}
      {info && <p className="form-info">{info}</p>}
    </div>
  )
}
