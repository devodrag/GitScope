import { useCallback, useEffect, useState } from 'react'
import {ArrowRight, File, FilePlus, Folder, FolderPlus, KeyRound, Loader2, Lock, LockOpen, Trash2 } from 'lucide-react'
import {
  manageApi, manageConnect, manageDisconnect, manageStatus
} from '../api'
import { useI18n } from '../i18n'
import type { AppError, ManagedBranch, ManagedEntry, ManagedRelease, ManagedRepo, ManageStatus } from '../types'
import { Button, EmptyState, ErrorState, IconButton, Modal, PageHeading, PendingButton } from '../components/ui'

const CREATE_TOKEN_URL = 'https://github.com/settings/tokens/new?description=GitScope%20Manage&scopes=repo,delete_repo'

type WorkspaceTab = 'files' | 'releases' | 'settings'

function fmtSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function Gate({ onConnected }: { onConnected: (status: ManageStatus) => void }) {
  const { t } = useI18n()
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  return <div style={{ maxWidth: 640 }}>
    <h2 className="sec">{t('manageTitle')}</h2>
    <p className="lead">{t('manageIntro')}</p>
    <div className="card" style={{ marginTop: 22 }}>
      <label className="field">
        {t('manageTokenLabel')}
        <input data-initial-focus type="password" autoComplete="off" spellCheck={false} value={token}
          onChange={event => setToken(event.target.value)} placeholder="ghp_…" />
      </label>
      {error && <ErrorState error={error} />}
      <div className="dialog-actions">
        <a className="ghost" style={{ borderRadius: 999, padding: '8px 16px' }} href={CREATE_TOKEN_URL} target="_blank" rel="noreferrer">
          {t('manageTokenLabel')} ↗
        </a>
        <PendingButton variant="primary" pending={pending} disabled={!token.trim()} onClick={() => {
          setPending(true); setError(undefined)
          manageConnect(token.trim()).then(onConnected).catch(failure => setError(asAppError(failure))).finally(() => setPending(false))
        }}>{t('manageConnect')}</PendingButton>
      </div>
    </div>
  </div>
}

function asAppError(error: unknown): AppError {
  if (typeof error === 'object' && error !== null && 'code' in error) return error as AppError
  return { code: 'system', detail: String(error) }
}

function NewRepoModal({ close, onCreated }: { close: () => void; onCreated: (repo: ManagedRepo) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setPrivate] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  const clean = name.trim().replace(/^\/+|\/+$/g, '')
  return <Modal title={t('manageNewRepo')} onClose={close}>
    <form onSubmit={event => {
      event.preventDefault()
      setPending(true); setError(undefined)
      manageApi<{ full_name: string }>('create', {
        name: clean, description: description.trim(), private: isPrivate, autoInit: true
      }).then(created => {
        onCreated({
          full_name: created.full_name, name: created.full_name.split('/')[1], private: isPrivate,
          description: description.trim(), html_url: `https://github.com/${created.full_name}`,
          pushed_at: null, stargazers_count: 0, default_branch: 'main'
        })
        close()
      }).catch(failure => setError(asAppError(failure))).finally(() => setPending(false))
    }}>
      <label className="field">{t('manageRepoName')}
        <input data-initial-focus required value={name} onChange={event => setName(event.target.value)} placeholder="owner/new-repo" />
      </label>
      <label className="field">{t('manageDescription')}
        <input value={description} onChange={event => setDescription(event.target.value)} maxLength={320} />
      </label>
      <label className="field" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="checkbox" checked={isPrivate} onChange={event => setPrivate(event.target.checked)} />{t('managePrivate')}
      </label>
      <label className="field" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="checkbox" defaultChecked />{t('manageAutoInit')}
      </label>
      {error && <ErrorState error={error} />}
      <div className="dialog-actions">
        <Button onClick={close}>{t('cancel')}</Button>
        <PendingButton variant="primary" pending={pending} type="submit">{t('manageCreate')}</PendingButton>
      </div>
    </form>
  </Modal>
}

function FileEditor({ full, branch, entry, isNew, close, onSaved }: {
  full: string; branch: string; entry: ManagedEntry | null; isNew: boolean
  close: () => void; onSaved: () => void
}) {
  const { t } = useI18n()
  const [path, setPath] = useState(entry?.path ?? '')
  const [content, setContent] = useState('')
  const [message, setMessage] = useState(isNew ? '' : `update ${entry?.name ?? 'file'}`)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  const [loading, setLoading] = useState(!isNew && Boolean(entry?.path))
  useEffect(() => {
    if (isNew || !entry?.path) return
    manageApi<ManagedEntry>('file', { full, path: entry.path, branch }).then(data => {
      const raw = data.content ?? ''
      const decoded = data.encoding === 'base64'
        ? atob(raw.replace(/\n/g, ''))
        : raw
      try { setContent(decodeURIComponent(escape(decoded))) } catch { setContent(decoded) }
    }).catch(failure => setError(asAppError(failure))).finally(() => setLoading(false))
  }, [full, branch, entry, isNew])
  return <Modal title={isNew ? t('manageNewFile') : t('manageEditFile')} onClose={close}>
    {loading ? <div className="empty"><Loader2 className="spin" /></div> : <form onSubmit={event => {
      event.preventDefault()
      setPending(true); setError(undefined)
      const sha = isNew ? undefined : entry?.sha
      manageApi<{ content?: { sha: string; commit: { sha: string } } }>('save_file', {
        full, path: path.replace(/^\/+/, ''), branch,
        message: message.trim() || (isNew ? `create ${path}` : `update ${path}`),
        content: btoa(unescape(encodeURIComponent(content))),
        sha
      }).then(() => { onSaved(); close() })
        .catch(failure => setError(asAppError(failure))).finally(() => setPending(false))
    }}>
      <label className="field">{t('managePath')}
        <input required value={path} onChange={event => setPath(event.target.value)} placeholder="src/main.rs" spellCheck={false} />
      </label>
      <label className="field">{t('manageContent')}
        <textarea required rows={12} value={content} onChange={event => setContent(event.target.value)} spellCheck={false}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} />
      </label>
      <label className="field">{t('manageCommitMessage')}
        <input required value={message} onChange={event => setMessage(event.target.value)} maxLength={220} />
      </label>
      {error && <ErrorState error={error} />}
      <div className="dialog-actions">
        <Button onClick={close}>{t('cancel')}</Button>
        <PendingButton variant="primary" pending={pending} type="submit">{t('manageCommit')}</PendingButton>
      </div>
    </form>}
  </Modal>
}

function DeleteFileModal({ full, branch, entry, close, onDeleted }: {
  full: string; branch: string; entry: ManagedEntry; close: () => void; onDeleted: () => void
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState(`delete ${entry.name}`)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  return <Modal title={`${t('manageDelete')}: ${entry.name}`} onClose={close}>
    <form onSubmit={event => {
      event.preventDefault()
      setPending(true); setError(undefined)
      manageApi('delete_file', {
        full, path: entry.path, branch, message: message.trim(), sha: entry.sha
      }).then(() => { onDeleted(); close() })
        .catch(failure => setError(asAppError(failure))).finally(() => setPending(false))
    }}>
      <p className="muted">{entry.path}</p>
      <label className="field">{t('manageCommitMessage')}
        <input required value={message} onChange={event => setMessage(event.target.value)} />
      </label>
      {error && <ErrorState error={error} />}
      <div className="dialog-actions">
        <Button onClick={close}>{t('cancel')}</Button>
        <PendingButton variant="primary" pending={pending} type="submit">{t('manageDelete')}</PendingButton>
      </div>
    </form>
  </Modal>
}

function NewReleaseModal({ full, defaultBranch, close, onCreated }: {
  full: string; defaultBranch: string; close: () => void; onCreated: () => void
}) {
  const { t } = useI18n()
  const [tag, setTag] = useState('')
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState(defaultBranch)
  const [asset, setAsset] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  return <Modal title={t('manageNewRelease')} onClose={close}>
    <form onSubmit={event => {
      event.preventDefault()
      setPending(true); setError(undefined)
      manageApi<{ id: number }>('new_release', { full, tag: tag.trim(), name: name.trim() || tag.trim(), body: body, target: target.trim() })
        .then(created => {
          if (!asset) { onCreated(); close(); return }
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result)
            manageApi('upload_asset', { full, id: created.id, name: asset.name, data: dataUrl.split(',')[1] ?? '' })
              .then(() => { onCreated(); close() })
              .catch(failure => { setError(asAppError(failure)); setPending(false) })
          }
          reader.readAsDataURL(asset)
        })
        .catch(failure => { setError(asAppError(failure)); setPending(false) })
    }}>
      <label className="field">{t('manageTag')}<input required data-initial-focus value={tag} onChange={event => setTag(event.target.value)} placeholder="v1.0.0" /></label>
      <label className="field">{t('manageReleaseTitle')}<input value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="field">{t('manageReleaseNotes')}<textarea rows={6} value={body} onChange={event => setBody(event.target.value)} /></label>
      <label className="field">{t('manageTarget')}<input value={target} onChange={event => setTarget(event.target.value)} placeholder={defaultBranch} /></label>
      <label className="field">{t('manageUpload')}
        <input type="file" onChange={event => setAsset(event.target.files?.[0] ?? null)} />
        <small className="muted">≤ 30 MB · {t('manageUpload')}</small>
      </label>
      {error && <ErrorState error={error} />}
      <div className="dialog-actions">
        <Button onClick={close}>{t('cancel')}</Button>
        <PendingButton variant="primary" pending={pending} type="submit">
          {t('manageCreate')}
        </PendingButton>
      </div>
    </form>
  </Modal>
}

function RepoWorkspace({ repo, back }: { repo: ManagedRepo; back: () => void }) {
  const { t } = useI18n()
  const full = repo.full_name
  const [tab, setTab] = useState<WorkspaceTab>('files')
  const [branch, setBranch] = useState(repo.default_branch)
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<ManagedEntry[]>([])
  const [branches, setBranches] = useState<ManagedBranch[]>([])
  const [releases, setReleases] = useState<ManagedRelease[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [editor, setEditor] = useState<{ isNew: boolean; entry: ManagedEntry | null } | null>(null)
  const [deleting, setDeleting] = useState<ManagedEntry | null>(null)
  const [branchModal, setBranchModal] = useState(false)
  const [releaseModal, setReleaseModal] = useState(false)
  const [settingsError, setSettingsError] = useState<AppError>()
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [description, setDescription] = useState(repo.description ?? '')
  const [deleteName, setDeleteName] = useState('')
  const [removing, setRemoving] = useState(false)

  const loadTree = useCallback((nextPath: string, nextBranch: string) => {
    setLoading(true); setError(undefined)
    manageApi<ManagedEntry[]>('tree', { full, path: nextPath, branch: nextBranch })
      .then(list => setEntries(Array.isArray(list) ? list : []))
      .catch(failure => { setError(asAppError(failure)); setEntries([]) })
      .finally(() => setLoading(false))
  }, [full])

  useEffect(() => {
    manageApi<ManagedBranch[]>('branches', { full }).then(list => {
      setBranches(list)
      if (!list.some(item => item.name === branch)) setBranch(list[0]?.name ?? repo.default_branch)
    }).catch(() => undefined)
  }, [full])

  useEffect(() => { if (tab === 'files') loadTree(path, branch) }, [tab, path, branch])
  useEffect(() => {
    if (tab === 'releases') {
      setLoading(true)
      manageApi<ManagedRelease[]>('releases', { full }).then(list => setReleases(list)).catch(failure => setError(asAppError(failure))).finally(() => setLoading(false))
    }
  }, [tab, full])

  const crumbs = path ? path.split('/') : []
  return <div>
    <div className="repo-head">
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 30 }}>{repo.name}</h1>
        <p className="muted" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {repo.private ? <Lock size={15} /> : <LockOpen size={15} />}
          {full}
          <span style={{ color: 'var(--accent)' }}>· {branch}</span>
        </p>
      </div>
      <Button onClick={back}>← {t('manageRepos')}</Button>
    </div>
    <div className="tabs">
      {(['files', 'releases', 'settings'] as WorkspaceTab[]).map(item => (
        <button key={item} className={tab === item ? 'on' : ''} onClick={() => setTab(item)}>
          {item === 'files' ? t('manageFiles') : item === 'releases' ? t('manageReleases') : t('manageRepoSettings')}
        </button>
      ))}
    </div>
    {error && <ErrorState error={error} />}

    {tab === 'files' && <div className="card">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={branch} onChange={event => setBranch(event.target.value)} className="ghost"
          style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--panel2)', color: 'var(--text)' }}>
          {branches.map(item => <option key={item.name}>{item.name}</option>)}
        </select>
        <Button onClick={() => setBranchModal(true)}>＋ {t('manageNewBranch')}</Button>
        <Button onClick={() => setEditor({ isNew: true, entry: null })}>＋ {t('manageNewFile')}</Button>
        <div style={{ marginLeft: 'auto' }} className="muted">{path || '/'}</div>
      </div>
      {path && <p style={{ margin: '6px 0' }}>
        <a onClick={() => setPath(crumbs.slice(0, -1).join('/'))}>← {crumbs[crumbs.length - 1]}</a>
      </p>}
      {loading ? <div className="empty"><Loader2 className="spin" /></div> :
        entries.length === 0 ? <EmptyState icon={Folder} description={t('digestEmpty')} /> :
          <ul className="list">
            {entries.map(item => <li key={item.path}>
              {item.type === 'dir' ? <Folder size={18} /> : <File size={18} />}
              <span className="nm">{item.name}</span>
              <small>{item.type === 'file' ? fmtSize(item.size) : ''}</small>
              <span style={{ display: 'flex', gap: 6 }}>
                {item.type === 'file' && <>
                  <IconButton icon={FilePlus} label={t('manageEditFile')} onClick={() => setEditor({ isNew: false, entry: item })} />
                  <IconButton icon={Trash2} label={t('manageDelete')} onClick={() => setDeleting(item)} />
                </>}
              </span>
            </li>)}
          </ul>}
    </div>}

    {tab === 'releases' && <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{t('manageReleases')}</h3>
        <Button onClick={() => setReleaseModal(true)}>＋ {t('manageNewRelease')}</Button>
      </div>
      {loading ? <div className="empty"><Loader2 className="spin" /></div> :
        releases.length === 0 ? <EmptyState icon={FolderPlus} description={t('digestEmpty')} /> :
          <ul className="list">
            {releases.map(release => <li key={release.id}>
              <span><span className="nm">{release.name || release.tag_name}</span> <span className="badge">{release.tag_name}</span></span>
              <small>{release.published_at ? new Date(release.published_at).toLocaleDateString() : ''} · {release.assets.length} assets</small>
            </li>)}
          </ul>}
    </div>}

    {tab === 'settings' && <div className="card">
      <h3 style={{ marginTop: 0 }}>{t('manageRepoSettings')}</h3>
      <label className="field">{t('manageDescription')}
        <input value={description} onChange={event => setDescription(event.target.value)} maxLength={320} />
      </label>
      {settingsSaved && <p style={{ color: 'var(--accent)' }}>{t('saved')}</p>}
      {settingsError && <ErrorState error={settingsError} />}
      <PendingButton variant="primary" pending={false} onClick={() => {
        manageApi('patch', { full, description }).then(() => setSettingsSaved(true))
          .catch(failure => setSettingsError(asAppError(failure)))
      }}>{t('save')}</PendingButton>
      <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '22px 0' }} />
      <h3 style={{ color: 'var(--red, #e57757)' }}>{t('manageDelete')}</h3>
      <p className="muted">{t('manageDeleteHint')}: <b>{full}</b></p>
      <label className="field">
        <input value={deleteName} onChange={event => setDeleteName(event.target.value)} placeholder={full} spellCheck={false} />
      </label>
      {settingsError && <ErrorState error={settingsError} />}
      <PendingButton pending={removing} disabled={deleteName !== full} onClick={() => {
        setRemoving(true); setSettingsError(undefined)
        manageApi('delete', { full }).then(() => {
          setRemoving(false); back()
        }).catch(failure => { setSettingsError(asAppError(failure)); setRemoving(false) })
      }}>{t('manageDelete')}</PendingButton>
    </div>}

    {editor && <FileEditor full={full} branch={branch} entry={editor.entry} isNew={editor.isNew}
      close={() => setEditor(null)} onSaved={() => { setEditor(null); loadTree(path, branch) }} />}
    {deleting && <DeleteFileModal full={full} branch={branch} entry={deleting} close={() => setDeleting(null)}
      onDeleted={() => { setDeleting(null); loadTree(path, branch) }} />}
    {branchModal && <BranchModal full={full} defaultBranch={repo.default_branch} close={() => setBranchModal(false)}
      onCreated={name => { setBranchModal(false); setBranch(name) }} />}
    {releaseModal && <NewReleaseModal full={full} defaultBranch={branch} close={() => setReleaseModal(false)}
      onCreated={() => { setReleaseModal(false); setTab('releases') }} />}
  </div>
}

function BranchModal({ full, defaultBranch, close, onCreated }: {
  full: string; defaultBranch: string; close: () => void; onCreated: (name: string) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [from, setFrom] = useState(defaultBranch)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError>()
  return <Modal title={t('manageNewBranch')} onClose={close}>
    <form onSubmit={event => {
      event.preventDefault()
      setPending(true); setError(undefined)
      manageApi('new_branch', { full, name: name.trim(), from }).then(() => { onCreated(name.trim()); close() })
        .catch(failure => setError(asAppError(failure))).finally(() => setPending(false))
    }}>
      <label className="field">{t('manageNewBranch')}<input required data-initial-focus value={name} onChange={event => setName(event.target.value)} placeholder="feature/…" /></label>
      <label className="field">{t('manageTarget')}<input value={from} onChange={event => setFrom(event.target.value)} placeholder={defaultBranch} /></label>
      {error && <ErrorState error={error} />}
      <div className="dialog-actions">
        <Button onClick={close}>{t('cancel')}</Button>
        <PendingButton variant="primary" pending={pending} type="submit">{t('manageCreate')}</PendingButton>
      </div>
    </form>
  </Modal>
}

export function Manage() {
  const { t } = useI18n()
  const [status, setStatus] = useState<ManageStatus | null>(null)
  const [statusError, setStatusError] = useState<AppError>()
  const [repos, setRepos] = useState<ManagedRepo[]>([])
  const [reposError, setReposError] = useState<AppError>()
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [newRepo, setNewRepo] = useState(false)
  const [workspace, setWorkspace] = useState<ManagedRepo | null>(null)

  const loadStatus = useCallback(() => {
    manageStatus().then(setStatus).catch(failure => setStatusError(asAppError(failure)))
  }, [])
  const loadRepos = useCallback(() => {
    setLoading(true); setReposError(undefined)
    manageApi<ManagedRepo[]>('repos').then(list => setRepos(list))
      .catch(failure => setReposError(asAppError(failure)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadStatus() }, [])
  useEffect(() => {
    if (status?.connected) { setRepos([]); loadRepos() }
  }, [status?.connected])

  if (statusError) return <div><PageHeading title={t('manage')} /><ErrorState error={statusError} /></div>
  if (!status) return <div className="empty"><Loader2 className="spin" /></div>

  if (!status.connected) {
    return <div><PageHeading title={t('manage')} />
      <Gate onConnected={next => { setStatus(next); loadRepos() }} />
    </div>
  }

  const visible = repos.filter(repo => repo.full_name.toLowerCase().includes(filter.toLowerCase()))

  return <div>
    <PageHeading title={t('manage')} />
    <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeyRound size={16} /> {t('manageConnected')} <b>@{status.login}</b>
      </span>
      <span className="muted" style={{ fontSize: 13 }}>{t('manageScopes')}: <b>{status.scopes || '—'}</b></span>
      <PendingButton pending={false} style={{ marginLeft: 'auto' }} onClick={() => {
        manageDisconnect().then(() => { setStatus({ connected: false, login: '', scopes: '' }); setRepos([]); setWorkspace(null) })
      }}>{t('manageDisconnect')}</PendingButton>
    </div>

    {workspace ? <RepoWorkspace repo={workspace} back={() => setWorkspace(null)} /> : <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0 16px', flexWrap: 'wrap' }}>
        <h2 className="sec" style={{ margin: 0, fontSize: 26 }}>{t('manageRepos')}</h2>
        <Button variant="primary" onClick={() => setNewRepo(true)}>＋ {t('manageNewRepo')}</Button>
        <input placeholder="filter…" value={filter} onChange={event => setFilter(event.target.value)} className="ghost"
          style={{ marginLeft: 'auto', borderRadius: 999, padding: '9px 16px', background: 'var(--panel2)', color: 'var(--text)' }} />
      </div>
      {reposError && <ErrorState error={reposError} />}
      {loading ? <div className="empty"><Loader2 className="spin" /></div> :
        visible.length === 0 ? <EmptyState icon={FolderPlus} description={t('digestEmpty')} /> :
          <ul className="list">
            {visible.map(repo => <li key={repo.full_name}>
              {repo.private ? <Lock size={16} /> : <LockOpen size={16} />}
              <span><span className="nm">{repo.full_name}</span>{repo.private && <span className="badge">private</span>}<br />
                <small style={{ margin: 0 }}>{repo.description || '—'}</small></span>
              <small>{repo.pushed_at ? new Date(repo.pushed_at).toLocaleDateString() : ''}</small>
              <span style={{ display: 'flex', gap: 6 }}>
                <IconButton icon={ArrowRight} label={t('manageFiles')} onClick={() => setWorkspace(repo)} />
              </span>
            </li>)}
          </ul>}
    </>}

    {newRepo && <NewRepoModal close={() => setNewRepo(false)} onCreated={created => {
      setNewRepo(false); loadRepos(); setWorkspace(created)
    }} />}
  </div>
}

export default Manage
