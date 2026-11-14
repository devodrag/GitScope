import { QueryClient, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { asError, query } from './api'
import type { AppError, Queries } from './types'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000, gcTime: 15 * 60_000, retry: false,
      refetchOnWindowFocus: false, refetchOnReconnect: false, networkMode: 'always',
    },
  },
})
export function clearClientCache() { queryClient.clear() }

export interface RequestState<T> { data?: T; error?: AppError; pending: boolean; refreshing: boolean; retry: () => void }

export function useData<K extends keyof Queries>(endpoint: K, args: Queries[K][0] | null, revision: number): RequestState<Queries[K][1]> {
  type Value = Queries[K][1]
  const previous = useRef(revision)
  const refresh = useRef(false)
  const result = useQuery<Value, AppError>({
    queryKey: [endpoint, args],
    enabled: args !== null,
    queryFn: async ({ signal }) => {
      try {
        if (!args) throw { code: 'validation' }
        const force = refresh.current
        refresh.current = false
        return await query(endpoint, args, force, signal)
      } catch (error) { throw asError(error) }
    },
  })
  const { refetch } = result
  const retry = useCallback(() => {
    if (args !== null && queryClient.getQueryState([endpoint, args])?.fetchStatus !== 'fetching') {
      refresh.current = true
      void refetch({ cancelRefetch: false })
    }
  }, [args, endpoint, refetch])
  useEffect(() => {
    if (previous.current === revision) return
    previous.current = revision
    retry()
  }, [retry, revision])
  return { data: result.data, error: result.error ?? undefined, pending: result.isFetching && result.data === undefined, refreshing: result.isFetching, retry }
}

export function useDebounced<T>(value: T, delay = 400) {
  const [stable, setStable] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setStable(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return stable
}

export function invalidateClientKey(endpoint: keyof Queries) {
  void queryClient.invalidateQueries({ queryKey: [endpoint] })
}
