const dateFormats = new Map<string, Intl.DateTimeFormat>()
const numberFormats = new Map<string, Intl.NumberFormat>()

export function formatDate(value: string | null | undefined, locale: string, full = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  const key = `${locale}:${full}`
  let formatter = dateFormats.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, full ? { dateStyle: 'medium' } : { month: 'short', day: 'numeric' })
    dateFormats.set(key, formatter)
  }
  return formatter.format(date)
}
export function formatNumber(value: number | undefined, locale: string, compact = true) {
  if (value === undefined) return '—'
  const key = `${locale}:${compact}`
  let formatter = numberFormats.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, compact ? { notation: 'compact', maximumFractionDigits: 1 } : {})
    numberFormats.set(key, formatter)
  }
  return formatter.format(value)
}
