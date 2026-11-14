import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, CircleHelp, Inbox, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { errorText, useI18n } from '../i18n'
import type { AppError, Payload, Person } from '../types'
import { openGithub } from '../api'
import { formatNumber } from '../formats'
import { useWorkspace } from '../context'

export function Button({ children, variant = 'base', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'base' | 'primary' | 'quiet' | 'danger' }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{children}</button>
}
export function IconButton({ label, icon: Icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; variant?: "base" | "primary" | "quiet" | "danger" }) {
  return <Button {...props} className={`icon-button ${props.className ?? ''}`} aria-label={label} title={label}><Icon size={17} strokeWidth={1.75} /></Button>
}
export function PageHeading({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return <header className="page-heading">
    <div className="heading-copy">{children}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="heading-actions">{actions}</div>}
  </header>
}
export function ChartCard({ title, description, actions, children, className = '' }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>
    <header className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</header>
    {children}
  </section>
}
export function MetricCard({ label, value, note, icon: Icon, featured }: { label: string; value?: number | string | null; note?: string; icon: LucideIcon; featured?: boolean }) {
  const { locale } = useI18n()
  return <section className={`metric ${featured ? 'metric-featured' : ''}`}>
    <div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={16} strokeWidth={1.7} /></span></div>
    <strong key={value ?? 'empty'} className={value == null ? undefined : 'metric-value'}>{typeof value === 'number' ? formatNumber(value, locale, false) : value ?? '—'}</strong>
    {note && <p>{note}</p>}
  </section>
}
export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title?: string; description?: string; action?: ReactNode; icon?: LucideIcon }) {
  const { t } = useI18n()
  return <div className="empty-state"><span className="state-icon"><Icon size={22} strokeWidth={1.6} /></span><strong>{title ?? t('noData')}</strong>{description && <p>{description}</p>}{action}</div>
}
export function LoadingSkeleton({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  return <div className={`skeleton ${compact ? 'skeleton-compact' : ''}`} role="status" aria-label={t('loading')}><i /><i /><i /><span className="sr-only">{t('loading')}</span></div>
}
function retryNote(retryAt: AppError['retryAt'], locale: string, label: string) {
  return retryAt && retryAt > Date.now() / 1000
    ? `${label} ${new Date(retryAt * 1000).toLocaleTimeString(locale, { timeStyle: 'short' })}.` : ''
}
export function ErrorState({ error, retry, inline = false }: { error: AppError; retry?: () => void; inline?: boolean }) {
  const { t, locale } = useI18n()
  const message = errorText(error.code, t)
  const description = [message, retryNote(error.retryAt, locale, t('retryAfter'))].filter(Boolean).join(' ')
  if (inline) return <div className="inline-state" role="status"><TriangleAlert size={16} /><span>{description}</span>{retry && <Button variant="quiet" onClick={retry}>{t('retry')}</Button>}</div>
  return <EmptyState icon={AlertCircle} title={t('unavailable')} description={description} action={retry && <Button onClick={retry}>{t('retry')}</Button>} />
}
export function CacheNotice({ payload }: { payload?: Pick<Payload<unknown>, 'stale' | 'warning' | 'fetchedAt'> }) {
  const { t, locale } = useI18n()
  if (!payload?.stale) return null
  return <div className="inline-state" role="status"><TriangleAlert size={15} /><span>{t('cached')} · {new Date(payload.fetchedAt * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
    {payload.warning && ` · ${errorText(payload.warning.code, t)} ${retryNote(payload.warning.retryAt, locale, t('retryAfter'))}`}</span></div>
}
export function Avatar({ person, large = false }: { person?: Person | null; large?: boolean }) {
  const ref = useRef<HTMLImageElement>(null)
  let source = person?.avatar_url
  if (source?.startsWith('https://avatars.githubusercontent.com/')) {
    const sized = new URL(source)
    sized.searchParams.set('s', large ? '128' : '64')
    source = sized.toString()
  }
  useEffect(() => { if (ref.current) ref.current.hidden = false }, [source])
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">
    {person?.login ? person.login.slice(0, 2).toUpperCase() : <CircleHelp size={17} />}
    {source && <img ref={ref} src={source} alt="" width={large ? 62 : 32} height={large ? 62 : 32} loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true }} />}
  </span>
}
export function GithubLink({ url, children, minimal = false }: { url: string; children?: ReactNode; minimal?: boolean }) {
  const { t } = useI18n()
  const workspace = useWorkspace()
  return <Button variant={minimal ? 'quiet' : 'base'} onClick={() => void workspace.perform(() => openGithub(url))}>
    {children ?? t('openGitHub')}<ArrowUpRight size={15} />
  </Button>
}
export function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const { t } = useI18n()
  const restoreFocus = useRef<HTMLElement | null>(null)
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content aria-describedby={undefined} className={`modal ${className}`} onOpenAutoFocus={event => {
        restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const target = (event.target as HTMLElement).querySelector<HTMLElement>('[data-initial-focus]')
        if (target) { event.preventDefault(); target.focus() }
      }} onCloseAutoFocus={event => {
        if (restoreFocus.current?.isConnected) { event.preventDefault(); restoreFocus.current.focus() }
      }}>
        <header><Dialog.Title asChild><h2>{title}</h2></Dialog.Title><Dialog.Close asChild>
          <IconButton label={t('close')} icon={X} variant="quiet" />
        </Dialog.Close></header>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

export function ConfirmDialog({ title, description, confirm, onClose }: { title: string; description?: string; confirm: () => Promise<void>; onClose: () => void }) {
  const { t } = useI18n()
  const form = useRef<HTMLFormElement>(null)
  return <Modal title={title} onClose={onClose}><form ref={form} onSubmit={event => {
    event.preventDefault()
    const button = form.current?.querySelector<HTMLButtonElement>('button[type=submit]')
    if (button) button.disabled = true
    void confirm().finally(() => { if (button) button.disabled = false })
  }}>
    {description && <p className="muted">{description}</p>}
    <div className="dialog-actions"><Button onClick={onClose}>{t('cancel')}</Button><Button type="submit" variant="danger">{t('confirm')}</Button></div>
  </form></Modal>
}
export function PendingButton({ pending, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pending: boolean; variant?: 'base' | 'primary' }) {
  return <Button {...props} disabled={pending || props.disabled}>{pending && <LoaderCircle size={16} className="spin" />}{children}</Button>
}
