import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Categories() {
  const { entityId } = useOutletContext()
  const [categories, setCategories] = useState(null)
  const [name, setName] = useState('')
  const [categoryType, setCategoryType] = useState('expense')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadCategories() {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('entity_id', entityId)
      .eq('is_archived', false)
      .order('category_type')
      .order('name')
    if (error) setError(error.message)
    else setCategories(data)
  }

  useEffect(() => {
    loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    const { error } = await supabase
      .from('categories')
      .insert({ entity_id: entityId, name: name.trim(), category_type: categoryType })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    loadCategories()
  }

  async function handleArchive(id) {
    if (!confirm('Archive this category? Past transactions keep it, it just stops showing for new ones.')) return
    await supabase.from('categories').update({ is_archived: true }).eq('id', id)
    loadCategories()
  }

  const income = categories?.filter((c) => c.category_type === 'income') ?? []
  const expense = categories?.filter((c) => c.category_type === 'expense') ?? []

  return (
    <div className="page">
      {/* Categories left the sidebar to live under Settings, so this is the
          only way back up - without it the page is a one-way door. */}
      <Link to="../settings" className="breadcrumb-back">
        ← Settings
      </Link>
      <h1>Categories</h1>
      <p className="page-subtitle">
        The labels you pick when you log a transaction — like &quot;Egg Sales&quot; or &quot;Feed &amp;
        Supplies.&quot; They&apos;re what breaks the Money page down by where money actually came from and
        went, instead of just one big number.
      </p>

      {categories === null && <p>Loading…</p>}

      {categories && (
        <div className="category-columns">
          <div>
            <h3>Income</h3>
            <p className="page-subtitle">Where money comes in from.</p>
            <ul className="simple-list">
              {income.map((c) => (
                <li key={c.id}>
                  {c.name}
                  <button
                    className="header-btn header-btn--sm header-btn--danger"
                    onClick={() => handleArchive(c.id)}
                  >
                    Archive
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Expense</h3>
            <p className="page-subtitle">What money gets spent on.</p>
            <ul className="simple-list">
              {expense.map((c) => (
                <li key={c.id}>
                  {c.name}
                  <button
                    className="header-btn header-btn--sm header-btn--danger"
                    onClick={() => handleArchive(c.id)}
                  >
                    Archive
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <form className="inline-form" onSubmit={handleCreate}>
        <h2>Add a category</h2>
        <p className="page-subtitle">
          Make a new bucket to sort transactions into. Pick <strong>Income</strong> for money coming
          in and <strong>Expense</strong> for money going out — that&apos;s what decides which side of
          the Money summary it shows up on.
        </p>
        <div className="form-row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Egg Sales" required />
          </label>
          <label>
            Type
            <select value={categoryType} onChange={(e) => setCategoryType(e.target.value)}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add category'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>
    </div>
  )
}
