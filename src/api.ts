import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppError, Bootstrap, DeviceCode, Queries, WatchRefresh } from './types'

export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return Promise.reject({ code: 'native' } satisfies AppError)
  return invoke<T>(command, args)
}

export const bootstrap = () => call<Bootstrap>('bootstrap')
export const local = <T = void>(operation: string, args: object = {}) => call<T>('local', { operation, args })
export const openGithub = (url: string) => call<void>('open_github', { url })
export const copyText = (text: string) => call<void>('copy_text', { text })
export const exportData = (name?: string) => call<boolean>('export_data', { name: name ?? null })
export const beginAuth = () => call<DeviceCode>('auth_begin')
export const finishAuth = () => call('auth_finish')
export const connectToken = (token: string) => call('auth_connect_token', { token })
export const cancelAuth = () => call<void>('auth_cancel')
export const logout = () => call<void>('auth_logout')
export const refreshWatched = () => local<WatchRefresh>('refresh_watched')
export const nightDigest = () => call<import('./types').Digest>('local', { operation: 'digest', args: {} })
export const digestSeen = () => local('digest_seen')
export const manageStatus = () => local<import('./types').ManageStatus>('local', { operation: 'manage_status', args: {} })
export const manageConnect = (token: string) => local<import('./types').ManageStatus>('local', { operation: 'manage_connect', args: { token } })
export const manageDisconnect = () => local('manage_disconnect')
export const manageApi = <T = unknown>(operation: string, args: Record<string, unknown> = {}) => local<T>(`manage_${operation}`, args)

export function asError(error: unknown): AppError {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error as AppError
  }
  return { code: 'system', detail: typeof error === 'string' ? error : undefined }
}

let requestSequence = 0

export function query<K extends keyof Queries>(endpoint: K, args: Queries[K][0], refresh: boolean, signal: AbortSignal) {
  const requestId = `${Date.now()}-${++requestSequence}`
  const abort = () => { void call('cancel_request', { requestId }).catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  return call<Queries[K][1]>('query', { endpoint, args, refresh, requestId }).finally(() => signal.removeEventListener('abort', abort))
}

export function repositoryName(input: string) {
  const name = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '')
  const [owner, repo, extra] = name.split('/')
  if (extra !== undefined || !/^[\w.-]{1,100}$/.test(repo ?? '') || repo === '.' || repo === '..' || !/^[a-z0-9-]{1,100}$/i.test(owner)) return null
  return name
}
