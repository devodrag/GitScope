import { createContext, useContext } from 'react'
import type { Key } from './i18n'
import type { Bootstrap, Route, Settings } from './types'

interface Workspace {
  data: Bootstrap
  route: Route
  revision: number
  compared: string[]
  navigate: (route: Route) => void
  settings: (settings: Partial<Settings>) => Promise<void>
  refresh: () => void
  sync: () => Promise<void>
  notify: (message: string, error?: boolean) => void
  perform: <T>(action: () => Promise<T>, message?: Key) => Promise<T | undefined>
  watch: (name: string) => Promise<void>
  compare: (name?: string) => void
  setCompared: (names: string[]) => void
}
export const WorkspaceContext = createContext<Workspace | null>(null)
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('Workspace context missing')
  return value
}
