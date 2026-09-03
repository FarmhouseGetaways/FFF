import { useState } from 'react'
import { useEntityTypes } from '../lib/entityTypes'

const ADD_NEW = '__add_new__'

// A type dropdown that can also grow: picking "Add a new type" swaps in a
// text field, and whatever gets typed is saved straight onto the entity.
// Shared by the create form and entity settings so the two can't drift.
export default function EntityTypePicker({ value, onChange, id }) {
  const types = useEntityTypes()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  // The saved value may not be in the list yet - the list loads async, and
  // another device may have introduced a type this session hasn't seen.
  const options = types.some((t) => t.value === value)
    ? types
    : [...types, { value, label: value }].filter((t) => t.value)

  function handleSelect(e) {
    if (e.target.value === ADD_NEW) {
      setDraft('')
      setAdding(true)
      return
    }
    onChange(e.target.value)
  }

  function commitDraft() {
    const next = draft.trim()
    if (next) onChange(next)
    setAdding(false)
  }

  if (adding) {
    return (
      <div className="type-add-row">
        <input
          id={id}
          autoFocus
          value={draft}
          placeholder="e.g. Orchard, Bakery, Cabin"
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDraft()
            }
            if (e.key === 'Escape') setAdding(false)
          }}
        />
        <button type="button" className="link-button" onClick={commitDraft}>
          Use it
        </button>
        <button type="button" className="link-button" onClick={() => setAdding(false)}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <select id={id} value={value} onChange={handleSelect}>
      {options.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
      <option value={ADD_NEW}>+ Add a new type…</option>
    </select>
  )
}
