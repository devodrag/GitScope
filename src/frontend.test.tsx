import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { repositoryName } from './api'
import { bucketEvents, eventUrl, formatDate } from './components/data'
import { EmptyState, MetricCard } from './components/ui'
import { Star } from 'lucide-react'
import { LanguageContext, errorText, translate } from './i18n'
import type { Event } from './types'

describe('repository and activity data', () => {
  it('validates direct repository links', () => {
    expect(repositoryName(' https://github.com/Rust-Lang/rust/ ')).toBe('Rust-Lang/rust')
    for (const value of ['rust-lang/..', 'rust-lang/rust/tree/main', 'https://example.com/rust/rust', 'just-a-name']) {
      expect(repositoryName(value)).toBeNull()
    }
  })
  it('does not add zero counts before the public event window', () => {
    const event: Event = {
      id: '1', actor: { login: 'tester', avatar_url: '' }, repo: { name: 'test/repo' },
      type: 'PushEvent', created_at: '2026-11-12T12:00:00Z', payload: { ref: 'refs/heads/main' },
    }
    expect(bucketEvents([event, { ...event, id: '2' }], '7D', new Date('2026-11-14T13:00:00Z'))).toEqual([
      { date: '2026-11-12', value: 2 }, { date: '2026-11-13', value: 0 }, { date: '2026-11-14', value: 0 },
    ])
    expect(eventUrl(event)).toBe('https://github.com/test/repo/commits/main')
    expect(formatDate('invalid', 'en-US')).toBe('—')
  })
})

describe('localized components', () => {
  it('renders missing metrics without inventing a value', () => {
    const view = renderToStaticMarkup(<MetricCard label="Stars" icon={Star} featured />)
    expect(view).toContain('—')
    expect(view).toContain('metric-featured')
  })
  it('renders Russian empty and error states', () => {
    const view = renderToStaticMarkup(<LanguageContext.Provider value="ru"><EmptyState /></LanguageContext.Provider>)
    expect(view).toContain('Данных пока нет')
    expect(errorText('offline', key => translate(key, 'ru'))).toContain('GitHub недоступен')
  })
})
