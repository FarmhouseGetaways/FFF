// Heuristics for turning an arbitrary bank/Venmo CSV export into transactions.
// Deterministic, rule-based "smart" matching - no external AI call, so it's
// free and instant, but it means suggestions should be reviewed before
// import, not trusted blindly.

const DATE_HEADER_HINTS = ['date', 'posted', 'transaction date', 'txn date']
const DESCRIPTION_HEADER_HINTS = ['description', 'memo', 'payee', 'name', 'details', 'narrative']
const AMOUNT_HEADER_HINTS = ['amount', 'amt']
const DEBIT_HEADER_HINTS = ['debit', 'withdrawal', 'money out']
const CREDIT_HEADER_HINTS = ['credit', 'deposit', 'money in']

function findHeader(headers, hints) {
  const lower = headers.map((h) => h.toLowerCase().trim())
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h === hint)
    if (idx !== -1) return headers[idx]
  }
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint))
    if (idx !== -1) return headers[idx]
  }
  return ''
}

// Guesses sensible starting column choices from the CSV's own header row.
// Always editable afterward - this just saves re-picking the same three
// columns on every bank's slightly different export.
export function guessColumns(headers) {
  const debit = findHeader(headers, DEBIT_HEADER_HINTS)
  const credit = findHeader(headers, CREDIT_HEADER_HINTS)
  return {
    dateField: findHeader(headers, DATE_HEADER_HINTS),
    descriptionField: findHeader(headers, DESCRIPTION_HEADER_HINTS),
    amountField: debit || credit ? '' : findHeader(headers, AMOUNT_HEADER_HINTS),
    debitField: debit,
    creditField: credit,
    useDebitCredit: Boolean(debit || credit),
  }
}

// Bank date formats vary (MM/DD/YYYY, YYYY-MM-DD, M/D/YY...); this tries the
// unambiguous ISO form first, then falls back to the browser's own parser
// (reliable for US-style dates, which covers the overwhelming majority of
// US bank/Venmo exports).
export function parseDate(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return trimmed.slice(0, 10)
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

export function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const cleaned = String(raw).replace(/[$,]/g, '').trim()
  const negativeParens = /^\((.*)\)$/.exec(cleaned)
  const num = Number(negativeParens ? `-${negativeParens[1]}` : cleaned)
  return Number.isNaN(num) ? null : num
}

// Merchant/keyword -> a generic label we then fuzzy-match against this
// entity's actual category names. Deliberately covers common small
// property/farmstand expenses rather than trying to be exhaustive.
const KEYWORD_HINTS = [
  [['home depot', 'lowes', "lowe's", 'ace hardware', 'menards'], 'supplies'],
  [['airbnb', 'vrbo', 'booking.com'], 'rental income'],
  [['farm stand', 'farmstand', 'square market'], 'farmstand sales'],
  [['geico', 'allstate', 'progressive', 'state farm', 'insurance'], 'insurance'],
  [['electric', 'power co', 'pg&e', 'water dept', 'utility', 'utilities', 'gas company'], 'utilities'],
  [['mortgage', 'loan pmt', 'loan payment'], 'mortgage loan payment'],
  [['county tax', 'property tax', 'tax assessor'], 'property tax'],
  [['stripe', 'square fee', 'paypal fee', 'processing fee'], 'platform payment processing fees'],
  [['facebook ads', 'instagram', 'google ads', 'marketing', 'advertising'], 'marketing advertising'],
  [['lawn', 'landscap', 'mulch', 'irrigation'], 'landscaping grounds'],
  [['cleaner', 'cleaning', 'housekeep', 'maid'], 'cleaning'],
  [['repair', 'maintenance', 'plumb', 'hvac', 'contractor'], 'repairs maintenance'],
]

function wordOverlapScore(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
  const wordsB = b.toLowerCase().split(/\W+/).filter(Boolean)
  return wordsB.reduce((score, w) => score + (wordsA.has(w) ? 1 : 0), 0)
}

// Returns the best-matching category id for a transaction description among
// this entity's categories of the given type (income/expense), or null if
// nothing scores well enough to suggest with any confidence.
export function guessCategory(description, categories, categoryType) {
  const candidates = categories.filter((c) => c.category_type === categoryType)
  if (candidates.length === 0) return null
  const desc = (description || '').toLowerCase()

  let genericLabel = null
  for (const [keywords, label] of KEYWORD_HINTS) {
    if (keywords.some((k) => desc.includes(k))) {
      genericLabel = label
      break
    }
  }

  const target = genericLabel || desc
  let best = null
  let bestScore = 0
  for (const c of candidates) {
    const score = wordOverlapScore(target, c.name) + (genericLabel && c.name.toLowerCase().includes(genericLabel.split(' ')[0]) ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return bestScore > 0 ? best.id : null
}
