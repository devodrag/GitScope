import { useMemo, useState } from 'react'
import { Bookmark, Folder, FolderPlus, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { local, refreshWatched, repositoryName } from '../api'
import { useWorkspace } from '../context'
import { useI18n } from '../i18n'
import { invalidateClientKey } from '../query'
import type { Collection, Watched } from '../types'
import { RepositoryCard } from '../components/data'
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Modal, PageHeading, PendingButton } from '../components/ui'

function AddRepository({ close }: { close: () => void }) {
  const { t } = useI18n()
  const workspace = useWorkspace()
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  return <Modal title={t('addRepo')} onClose={close}><form onSubmit={event => {
    event.preventDefault()
    const name = repositoryName(value)
    if (!name) return workspace.notify(t('error_validation'), true)
    setPending(true)
    void workspace.perform(async () => { await local('watch', { name }); await workspace.sync(); close() }, 'addedWatch').finally(() => setPending(false))
  }}><label className="field">{t('repositoryInput')}<input data-initial-focus required value={value} onChange={event => setValue(event.target.value)} placeholder={t('repoPlaceholder')} maxLength={220} /></label>
    <div className="dialog-actions"><Button onClick={close}>{t('cancel')}</Button><PendingButton pending={pending} type="submit" variant="primary">{t('addRepo')}</PendingButton></div>
  </form></Modal>
}

function Organize({ item, close }: { item: Watched; close: () => void }) {
  const { t } = useI18n()
  const workspace = useWorkspace()
  const [tags, setTags] = useState(item.tags.join(', '))
  const [selected, setSelected] = useState(item.collections)
  const [pending, setPending] = useState(false)
  return <Modal title={t('editOrganization')} onClose={close}><form onSubmit={event => {
    event.preventDefault()
    setPending(true)
    const tagsList = [...new Set(tags.split(',').map(value => value.trim()).filter(Boolean))]
    void workspace.perform(async () => {
      await local('organize', { name: item.repo.full_name, tags: tagsList, collections: selected })
      await workspace.sync(); close()
    }, 'saved').finally(() => setPending(false))
  }}>
    <label className="field">{t('tags')}<input data-initial-focus value={tags} onChange={event => setTags(event.target.value)} maxLength={850} /><small>{t('tagHint')}</small></label>
    <fieldset className="checkbox-group"><legend>{t('collections')}</legend>
      {workspace.data.collections.length === 0 && <p className="muted">{t('noCollections')}</p>}
      {workspace.data.collections.map(collection => <label key={collection.id}><input type="checkbox" checked={selected.includes(collection.id)}
        onChange={event => setSelected(current => event.target.checked ? [...current, collection.id] : current.filter(id => id !== collection.id))} />{collection.name}</label>)}
    </fieldset>
    <div className="dialog-actions"><Button onClick={close}>{t('cancel')}</Button><PendingButton pending={pending} variant="primary" type="submit">{t('save')}</PendingButton></div>
  </form></Modal>
}

function CollectionForm({ entry, close }: { entry: Collection | null; close: () => void }) {
  const { t } = useI18n()
  const workspace = useWorkspace()
  const [name, setName] = useState(entry?.name ?? '')
  const [pending, setPending] = useState(false)
  return <Modal title={t(entry ? 'rename' : 'createCollection')} onClose={close}><form onSubmit={event => {
    event.preventDefault()
    setPending(true)
    void workspace.perform(async () => { await local('collection', { id: entry?.id, name: name.trim() }); await workspace.sync(); close() }, 'saved').finally(() => setPending(false))
  }}>
    <label className="field">{t('collectionName')}<input data-initial-focus required value={name} onChange={event => setName(event.target.value)} maxLength={60} /></label>
    <div className="dialog-actions"><Button onClick={close}>{t('cancel')}</Button><PendingButton pending={pending} type="submit" variant="primary">{t('save')}</PendingButton></div>
  </form></Modal>
}

function WatchGrid({ items }: { items: Watched[] }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<Watched>()
  const [visible, setVisible] = useState(24)
  return <>
    <div className="card-grid">{items.slice(0, visible).map(item => <RepositoryCard repo={item.repo} key={item.repo.id}>
      <div className="watch-card-footer"><div className="chips">{item.tags.map(tag => <span key={tag} className="pill">{tag}</span>)}</div>
        <IconButton icon={Pencil} label={t('editOrganization')} onClick={() => setEditing(item)} /></div>
    </RepositoryCard>)}</div>
    {items.length > visible && <Button onClick={() => setVisible(value => value + 24)}>{t('more')}</Button>}
    {editing && <Organize item={editing} close={() => setEditing(undefined)} />}
  </>
}

export function Watchlist() {
  const workspace = useWorkspace()
  const { t, locale } = useI18n()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('added')
  const [collection, setCollection] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshErrors, setRefreshErrors] = useState<Awaited<ReturnType<typeof refreshWatched>>['errors']>([])
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const result = workspace.data.watchlist.filter(item => (!collection || item.collections.includes(Number(collection))) &&
      (!query || `${item.repo.full_name} ${item.repo.description ?? ''} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(query)))
    if (sort === 'stars') result.sort((a, b) => b.repo.stargazers_count - a.repo.stargazers_count)
    if (sort === 'name') result.sort((a, b) => a.repo.full_name.localeCompare(b.repo.full_name, locale))
    if (sort === 'earliest') result.sort((a, b) => a.added - b.added)
    return result
  }, [workspace.data.watchlist, collection, search, sort, locale])
  const refresh = () => {
    setRefreshing(true); setRefreshErrors([])
    void workspace.perform(async () => {
      const result = await refreshWatched()
      invalidateClientKey('snapshots'); invalidateClientKey('trending')
      setRefreshErrors(result.errors)
      await workspace.sync()
      workspace.notify(`${t('refreshDone')} · ${result.updated}`, result.errors.length > 0)
    }).finally(() => setRefreshing(false))
  }
  return <>
    <PageHeading title={t('watchlist')} description={t('watchSubtitle')} actions={<>
      <PendingButton pending={refreshing} disabled={workspace.data.watchlist.length === 0} onClick={refresh}><RefreshCw size={16} />{t('refreshWatchlist')}</PendingButton>
      <Button variant="primary" onClick={() => setAdding(true)}><Plus size={17} />{t('addRepo')}</Button>
    </>} />
    {refreshErrors[0] && <ErrorState inline error={refreshErrors[0]} />}
    {workspace.data.watchlist.length ? <>
      <div className="toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">{t('search')}</span>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('searchWatchlist')} /></label>
        <select aria-label={t('collections')} value={collection} onChange={event => setCollection(event.target.value)}><option value="">{t('all')}</option>
          {workspace.data.collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label={t('sort')} value={sort} onChange={event => setSort(event.target.value)}>
          {(['added', 'earliest', 'stars', 'name'] as const).map(value => <option key={value} value={value}>{t(value === 'stars' ? 'mostStars' : value)}</option>)}</select>
      </div>
      {rows.length ? <WatchGrid items={rows} key={`${collection}:${search}`} /> : <section className="panel"><EmptyState title={t('noResults')} description={t('changeFilters')} /></section>}
    </> : <section className="panel"><EmptyState icon={Bookmark} title={t('emptyWatch')} description={t('emptyWatchHelp')}
      action={<Button onClick={() => setAdding(true)}><Plus size={16} />{t('addRepo')}</Button>} /></section>}
    {adding && <AddRepository close={() => setAdding(false)} />}
  </>
}

export function Collections() {
  const workspace = useWorkspace()
  const { t } = useI18n()
  const [editing, setEditing] = useState<Collection | null | undefined>()
  const [deleting, setDeleting] = useState<Collection>()
  const current = workspace.data.collections.find(collection => String(collection.id) === workspace.route.subject)
  const items = workspace.data.watchlist.filter(item => current && item.collections.includes(current.id))
  return <>
    <PageHeading title={current?.name ?? t('collections')} description={t('collectionSubtitle')}
      actions={<Button variant="primary" onClick={() => setEditing(null)}><FolderPlus size={17} />{t('createCollection')}</Button>} />
    <div className="card-grid">{workspace.data.collections.map(entry => <article className="collection-card panel" key={entry.id}>
      <span className="state-icon"><Folder size={19} /></span><div><button className="plain-link" aria-pressed={current?.id === entry.id}
        onClick={() => workspace.navigate({ page: 'collections', subject: String(entry.id) })}>{entry.name}</button>
        <small>{workspace.data.watchlist.filter(item => item.collections.includes(entry.id)).length} · {t('repositories')}</small></div>
      <IconButton icon={Pencil} label={t('rename')} onClick={() => setEditing(entry)} /><IconButton icon={Trash2} label={t('delete')} onClick={() => setDeleting(entry)} />
    </article>)}</div>
    {workspace.data.collections.length === 0 && <section className="panel"><EmptyState icon={Folder} title={t('noCollections')} action={<Button onClick={() => setEditing(null)}>{t('createCollection')}</Button>} /></section>}
    {current && (items.length ? <WatchGrid items={items} key={current.id} /> : <section className="panel"><EmptyState icon={Folder}
      action={<Button onClick={() => workspace.navigate({ page: 'watchlist' })}>{t('watchlist')}</Button>} /></section>)}
    {editing !== undefined && <CollectionForm entry={editing} close={() => setEditing(undefined)} />}
    {deleting && <ConfirmDialog title={t('deleteCollection')} description={t('deleteCollectionHelp')} onClose={() => setDeleting(undefined)} confirm={async () => {
      await workspace.perform(async () => {
        await local('collection', { id: deleting.id })
        await workspace.sync()
        if (current?.id === deleting.id) workspace.navigate({ page: 'collections' })
        setDeleting(undefined)
      })
    }} />}
  </>
}
