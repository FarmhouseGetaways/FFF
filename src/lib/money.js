export function formatMoney(amount) {
  const value = Number(amount || 0)
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

// The owner's own calendar day. toISOString() is UTC, which turns an
// evening entry in the US into tomorrow's date.
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
