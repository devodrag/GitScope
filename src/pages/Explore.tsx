import { useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, Search as SearchIcon, SlidersHorizontal, UserRound } from 'lucide-react'
import { useWorkspace } from '../context'
import { useI18n, type Key } from '../i18n'
import { useData, useDebounced } from '../query'
import type { Person, SearchKind, SearchOptions } from '../types'
import { Avatar, Button, CacheNotice, EmptyState, ErrorState, LoadingSkeleton, Modal, PageHeading } from '../components/ui'
import { formatNumber, RepositoryCard } from '../components/data'

const kinds: [SearchKind, Key][] = [['repositories', 'repositories'], ['users', 'developers'], ['organizations', 'organizations']]
const filterFields: [keyof SearchOptions, Key, string][] = [
  ['language', 'language', 'Rust'], ['stars', 'starsFilter', '>=100'], ['forks', 'forksFilter', '>=10'], ['created', 'created', '>=2026-01-01'],
  ['updated', 'pushed', '>=2026-01-01'], ['topic', 'topic', 'desktop'], ['license', 'license', 'mit'],
]
type Filters = Omit<SearchOptions, 'kind' | 'query' | 'sort' | 'page'>

function FilterPopover({ filters, onClose, apply }: { filters: Filters; onClose: () => void; apply: (filters: Filters) => void }) {
  const [values, setValues] = useState(filters)
  const { t } = useI18n()
  return <Modal title={t('filters')} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); apply(values); onClose() }}>
      <div className="form-grid">
        {filterFields.map(([key, label, placeholder], index) => <label className="field" key={key}>{t(label)}<input
          data-initial-focus={index === 0 ? true : undefined} value={values[key as keyof Filters] ?? ''} maxLength={60}
          placeholder={placeholder} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        <label className="field">{t('archived')}<select value={values.archived ?? ''} onChange={event => setValues(current => ({ ...current, archived: event.target.value }))}>
          <option value="">{t('all')}</option><option value="false">{t('active')}</option><option value="true">{t('archived')}</option>
        </select></label>
      </div>
      <div className="dialog-actions"><Button onClick={() => setValues({})}>{t('clear')}</Button><Button variant="primary" type="submit">{t('apply')}</Button></div>
    </form>
  </Modal>
}

export function DeveloperCard({ person, organization = false }: { person: Person; organization?: boolean }) {
  const workspace = useWorkspace()
  const { t } = useI18n()
  return <article className="person-card panel">
    <Avatar person={person} large />
    <div><button className="plain-link" onClick={() => workspace.navigate({ page: organization ? 'organizations' : 'developers', subject: person.login })}>{person.name ?? person.login}</button>
      <small>@{person.login}</small></div>
    <span className="person-icon">{organization ? <Building2 size={18} aria-label={t('organizations')} /> : <UserRound size={18} aria-label={t('developers')} />}</span>
  </article>
}

export default function Explore() {
  const workspace = useWorkspace()
  const { t, locale } = useI18n()
  const [kind, setKind] = useState<SearchKind>(workspace.route.kind ?? 'repositories')
  const [text, setText] = useState(workspace.route.query ?? '')
  const [sort, setSort] = useState('best')
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<Filters>({})
  const [filterOpen, setFilterOpen] = useState(false)
  const stable = useDebounced(text.trim(), 420)
  const valid = kind === 'repositories' || stable.length > 0
  const typing = stable !== text.trim()
  const result = useData('search', valid && !typing ? { kind, query: stable, sort: kind === 'repositories' ? sort : 'best', page, ...(kind === 'repositories' ? filters : {}) } : null, workspace.revision)
  const filterCount = Object.values(filters).filter(Boolean).length
  const pending = result.pending || typing
  const updating = result.refreshing || pending
  return <>
    <PageHeading title={t('searchTitle')} description={t('searchSubtitle')} />
    <section className="panel search-panel">
      <div className="tabs">{kinds.map(([id, key]) => <Button key={id} variant={id === kind ? 'primary' : 'quiet'} aria-pressed={id === kind} onClick={() => { setKind(id); setPage(1) }}>{t(key)}</Button>)}</div>
      <div className="toolbar">
        <label className="search-field"><SearchIcon size={18} /><span className="sr-only">{t('search')}</span><input value={text} placeholder={t('searchAnything')} maxLength={200} onChange={event => { setText(event.target.value); setPage(1) }} /></label>
        {kind === 'repositories' && <><Button onClick={() => setFilterOpen(true)}><SlidersHorizontal size={16} />{t('filters')}{filterCount > 0 && <span className="pill">{filterCount}</span>}</Button>
          <select aria-label={t('sort')} value={sort} onChange={event => { setSort(event.target.value); setPage(1) }}>{(['best', 'mostStars', 'lastUpdated', 'newest'] as const).map((label, index) => <option value={['best', 'stars', 'updated', 'created'][index]} key={label}>{t(label)}</option>)}</select></>}
      </div>
      <p className="panel-footnote">{t('searchLimit')}</p>
    </section>
    {filterOpen && <FilterPopover filters={filters} apply={filters => { setFilters(filters); setPage(1) }} onClose={() => setFilterOpen(false)} />}
    {!valid && !pending ? <section className="panel"><EmptyState icon={SearchIcon} description={t('searchPeople')} /></section> :
      !result.data && pending ? <LoadingSkeleton /> : result.error && !result.data ? <section className="panel"><ErrorState error={result.error} retry={result.retry} /></section> : result.data && <>
        <CacheNotice payload={result.data} />
        {result.error && <ErrorState inline error={result.error} retry={result.retry} />}
        <div className="results-meta" aria-busy={updating}><strong>{formatNumber(result.data.data.total_count, locale, false)} {t('resultCount')}</strong>
          {updating ? <span role="status">{t('loading')}</span> : result.data.data.incomplete_results && <span>{t('incomplete')}</span>}</div>
        {result.data.data.items.length ? <div className="card-grid">{result.data.data.items.map(item => 'full_name' in item ?
          <RepositoryCard key={item.id} repo={item} /> : <DeveloperCard person={item} key={item.login} organization={kind === 'organizations'} />)}</div> :
          <section className="panel"><EmptyState title={t('noResults')} description={t('changeFilters')} /></section>}
        {(page > 1 || result.data.hasNext) && <div className="pagination">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t('previous')}><ArrowLeft size={16} /></Button>
          <span>{page}</span>
          <Button disabled={updating || !result.data.hasNext || page >= 50} onClick={() => setPage(page + 1)} aria-label={t('next')}><ArrowRight size={16} /></Button>
        </div>}
      </>}
  </>
}
