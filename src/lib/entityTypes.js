import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// The three we ship with. Anything else in this list came from the user
// typing it, and is stored on the entity row as plain text - see
// migration 0008 for why there's no lookup table.
export const BUILT_IN_TYPES = [
  { value: 'property', label: 'Rental Property' },
  { value: 'farmstand', label: 'Farmstand' },
  { value: 'other', label: 'Other' },
]

const BUILT_IN_LABELS = new Map(BUILT_IN_TYPES.map((t) => [t.value, t.label]))

// Custom types are shown exactly as they were typed; only the built-in
// values get a friendlier label than their stored form.
export function labelForType(value) {
  if (!value) return ''
  return BUILT_IN_LABELS.get(value) ?? value
}

// The built-in three, plus every type this user has already used. Keeps the
// picker useful across entities without needing anywhere to "manage" types.
export function useEntityTypes() {
  const [types, setTypes] = useState(BUILT_IN_TYPES)

  useEffect(() => {
    let active = true
    supabase
      .from('entities')
      .select('entity_type')
      .then(({ data }) => {
        if (!active || !data) return
        const seen = new Set(BUILT_IN_TYPES.map((t) => t.value))
        const extra = []
        for (const row of data) {
          const v = row.entity_type
          if (!v || seen.has(v)) continue
          seen.add(v)
          extra.push({ value: v, label: v })
        }
        extra.sort((a, b) => a.label.localeCompare(b.label))
        setTypes([...BUILT_IN_TYPES, ...extra])
      })
    return () => {
      active = false
    }
  }, [])

  return types
}
