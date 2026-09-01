export function formatMoney(amount) {
  const value = Number(amount || 0)
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
