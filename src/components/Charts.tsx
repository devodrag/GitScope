import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { LinePath } from '@visx/shape'
import { BarChart3 } from 'lucide-react'
import { useI18n } from '../i18n'
import type { Heatmap } from '../types'
import { EmptyState } from './ui'

export type Point = { date: string; value: number }
const languageColors = Array.from({ length: 6 }, (_, index) => `var(--series-${index + 1})`)

const chartWidth = 680, chartHeight = 225, left = 39, right = 18, top = 15, bottom = 28
const spanX = chartWidth - left - right, spanY = chartHeight - top - bottom
const baseline = chartHeight - bottom

function chartGeometry(points: Point[], bars: boolean) {
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 1)
  const unit = 10 ** (Math.floor(Math.log10(maxValue)) - 1)
  const step = Math.max(1, [1, 2, 2.5, 3, 4, 5, 7.5, 10, 20, 25, 30, 40, 50, 75, 100].map(n => n * unit).find(n => n >= maxValue / 3) ?? maxValue)
  const max = step * 3
  const dates = points.map(point => Date.parse(point.date))
  const day = 86_400_000
  const range = (dates.at(-1) ?? dates[0]) - dates[0]
  const slots = Math.max(1, range / day + 1)
  const coords = points.map((point, index) => ({
    x: left + spanX * (bars ? ((dates[index] - dates[0]) / day + .5) / slots : range === 0 ? .5 : (dates[index] - dates[0]) / range),
    y: top + spanY * (1 - point.value / max),
  }))
  const barWidth = Math.min(26, spanX / slots * .65)
  const tickCount = Math.min(6, points.length)
  const tickIndexes = Array.from({ length: tickCount }, (_, tick) => Math.round(tick * (points.length - 1) / Math.max(1, tickCount - 1)))
  return { coords, barWidth, max, tickIndexes }
}

const Plot = memo(function Plot({ points, geometry, bars, gradient, dateLabel, compact }: {
  points: Point[]; geometry: ReturnType<typeof chartGeometry>; bars: boolean; gradient: string;
  dateLabel: Intl.DateTimeFormat; compact: Intl.NumberFormat
}) {
  const { coords, barWidth, max, tickIndexes } = geometry
  const first = coords[0], last = coords[coords.length - 1]
  const path = coords.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
  return <>
    <defs><linearGradient id={gradient} x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".16" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    {Array.from({ length: 4 }, (_, tick) => {
      const y = top + spanY * tick / 3
      return <g key={tick}><line x1={left} x2={chartWidth - right} y1={y} y2={y} className="chart-grid" />
        <text x={left - 9} y={y + 4} textAnchor="end">{compact.format(Math.round(max * (1 - tick / 3)))}</text></g>
    })}
    <g className={bars ? 'plot-bars' : 'plot-line'}>
      {bars ? <path className="chart-bar" d={coords.map(({ x, y }) => {
        const height = baseline - y
        if (height <= 0) return ''
        const r = Math.min(5, barWidth / 3, height / 2)
        const l = x - barWidth / 2, rightEdge = x + barWidth / 2
        return `M${l},${y+r}Q${l},${y} ${l+r},${y}H${rightEdge-r}Q${rightEdge},${y} ${rightEdge},${y+r}V${baseline-r}Q${rightEdge},${baseline} ${rightEdge-r},${baseline}H${l+r}Q${l},${baseline} ${l},${baseline-r}Z`
      }).join('')} /> : <>
        <path d={`${path} L${last.x},${baseline} L${first.x},${baseline} Z`} fill={`url(#${gradient})`} />
        <LinePath data={coords} x={point => point.x} y={point => point.y} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {coords.length === 1 && <circle cx={first.x} cy={first.y} r="5" className="chart-marker" />}
      </>}
    </g>
    {tickIndexes.map(i => <text key={points[i].date} x={coords[i].x} y={chartHeight - 6} textAnchor={i === 0 && points.length > 1 ? 'start' : i === points.length - 1 && points.length > 1 ? 'end' : 'middle'}>{dateLabel.format(new Date(`${points[i].date}T00:00:00Z`))}</text>)}
  </>
})

export function SeriesChart({ points, label, bars = false }: { points: Point[]; label: string; bars?: boolean }) {
  const id = useId().replaceAll(':', '')
  const { locale } = useI18n()
  const [selected, setSelected] = useState<number | null>(null)
  const geometry = useMemo(() => chartGeometry(points, bars), [points, bars])
  const { coords } = geometry
  const dateLabel = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }), [locale])
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale])
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const frame = useRef<number | null>(null)
  const pointer = useRef(0)
  function stopPointer() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [geometry])
  if (!points.length) return <EmptyState icon={BarChart3} />
  function select(event: React.PointerEvent<SVGSVGElement>) {
    pointer.current = event.clientX
    if (frame.current !== null) return
    const svg = event.currentTarget
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const bounds = svg.getBoundingClientRect()
      if (!bounds.width) return
      const x = (pointer.current - bounds.left) / bounds.width * chartWidth
      let low = 0, high = coords.length - 1
      while (low < high) {
        const mid = (low + high) >>> 1
        if (x > (coords[mid].x + coords[mid + 1].x) / 2) low = mid + 1
        else high = mid
      }
      setSelected(low)
    })
  }
  const index = Math.min(selected ?? 0, points.length - 1)
  const active = selected === null ? undefined : coords[index]
  return <div className="series-chart" tabIndex={0} aria-label={label} onBlur={() => { stopPointer(); setSelected(null) }} onFocus={() => setSelected(0)} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    stopPointer()
    setSelected(Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1))))
  }}>
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={label} onPointerMove={select} onPointerLeave={() => { stopPointer(); setSelected(null) }}>
      <Plot key={`${label}:${bars}:${points[0].date}:${points.at(-1)?.date}:${points.length}`} points={points} geometry={geometry} bars={bars} gradient={id} dateLabel={dateLabel} compact={compact} />
      {active && <>
        <line x1={active.x} x2={active.x} y1={top} y2={baseline} className="chart-rule" />
        {bars && active.y < baseline ? <rect x={active.x - geometry.barWidth / 2} y={active.y} width={geometry.barWidth} height={baseline - active.y} rx={Math.min(5, geometry.barWidth / 3)} className="chart-bar-active" /> :
          !bars && <circle cx={active.x} cy={active.y} r="5" className="chart-marker" />}
      </>}
    </svg>
    {active && <div role="status" className="chart-tooltip" style={{ left: `clamp(48px, ${active.x / chartWidth * 100}%, calc(100% - 52px))` }}>{dateLabel.format(new Date(`${points[index].date}T00:00:00Z`))} <strong>{number.format(points[index].value)}</strong></div>}
  </div>
}

export function LanguageDistribution({ values, bytes = false }: { values: Record<string, number>; bytes?: boolean }) {
  const { t, locale } = useI18n()
  const parts = Object.entries(values).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])
  const total = parts.reduce((sum, [, value]) => sum + value, 0)
  if (!total) return <EmptyState />
  const displayed = parts.length > 6 ? [...parts.slice(0, 5), [t('other'), parts.slice(5).reduce((sum, [, value]) => sum + value, 0)] as [string, number]] : parts
  const number = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  let offset = 0
  const segments = displayed.map(([, value], index) => {
    const from = offset
    offset += value / total * 100
    return `${languageColors[index]} ${from}% ${offset}%`
  })
  return <div className="language-layout">
    <div className="donut" style={{ backgroundImage: `conic-gradient(${segments.join(',')})` }} aria-hidden="true">
      <div><strong>{bytes ? number.format(total) : parts.length}</strong><span>{bytes ? t('bytes') : t('languages')}</span></div>
    </div>
    <ul className="legend">
      {displayed.map(([name, value], index) => <li title={bytes ? `${name} · ${new Intl.NumberFormat(locale).format(value)} ${t('bytes')}` : undefined} key={name}>
        <i style={{ background: languageColors[index] }} /><span>{name}</span><strong>{new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / total)}</strong>
      </li>)}
    </ul>
  </div>
}

export function ContributionHeatmap({ calendar }: { calendar: Heatmap }) {
  const { t, locale } = useI18n()
  const format = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }), [locale])
  return <>
    <div className="heatmap-scroll"><div className="heatmap" role="img" aria-label={`${calendar.totalContributions} ${t('contributions')}`}>
      {calendar.weeks.map(week => <div className="heatmap-week" key={week.contributionDays[0]?.date}>
        {week.contributionDays.map((day, index) => {
          const level = day.contributionCount === 0 ? 0 : Math.min(4, 1 + Math.floor(Math.log2(day.contributionCount)))
          const row = new Date(day.date + 'T00:00:00Z').getUTCDay()
          return <span key={day.date || index} className="heatmap-day" data-level={level} style={{ gridRow: row + 1 } as CSSProperties} title={`${format.format(new Date(day.date + 'T00:00:00Z'))}: ${day.contributionCount}`} />
        })}
      </div>)}
    </div></div>
    <div className="heatmap-legend">{t('less')}{[0, 1, 2, 3, 4].map(level => <i key={level} className="heatmap-day" data-level={level} />)}{t('more')}</div>
  </>
}
