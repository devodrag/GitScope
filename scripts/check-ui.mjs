import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve('dist')
const output = resolve('work/ui')
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!path.startsWith(root + '/')) return res.writeHead(403).end()
  try {
    const data = await readFile(path)
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(data)
  }
  catch { res.writeHead(404).end() }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })

let browser
try {
  browser = await chromium.launch({ executablePath: process.env.GITSCOPE_TEST_BROWSER || undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: 1320, height: 880 }, reducedMotion: 'reduce', colorScheme: 'light' })
  page.setDefaultTimeout(10_000)
  const uncaught = []
  page.on('pageerror', error => uncaught.push(error.message))
  await page.addInitScript(() => {
    const settings = { theme: 'system', language: 'en', compact: false, collapsed: false, reducedMotion: false, startup: 'overview',
      cacheMb: 32, refreshMinutes: 60, desktopNotifications: true, dashboardLogin: '', oauthClientId: '' }
    const person = { login: 'fixture', name: 'Test owner', avatar_url: '', public_repos: 6, followers: 20, following: 3 }
    const names = ['Scope', 'Signal', 'Trail', 'Branch', 'Frame', 'Vector']
    const repos = names.map((name, index) => ({
      id: index + 1, name, full_name: 'fixture/' + name, owner: person, html_url: 'https://github.com/fixture/' + name,
      description: 'Repository fixture used exclusively by frontend integration tests.',
      language: ['TypeScript', 'Rust', 'Python'][index % 3], stargazers_count: 1800 - 210 * index,
      forks_count: 240 - 20 * index, subscribers_count: 20, open_issues_count: 14, archived: false, topics: [],
      created_at: '2024-01-05T12:00:00Z', updated_at: new Date().toISOString(), pushed_at: new Date().toISOString(), license: null,
    }))
    const events = Array.from({ length: 75 }, (_, i) => ({
      id: String(i), type: ['PushEvent', 'PullRequestEvent', 'ReleaseEvent', 'IssuesEvent'][i % 4],
      actor: person, repo: { name: repos[i % repos.length].full_name }, payload: {},
      created_at: new Date(Date.now() - ((i * i * 11) % 29) * 86400000 - i * 40000).toISOString(),
    }))
    const bootstrap = { settings, account: null, watchlist: [], collections: [], notifications: [], oauthConfigured: false, version: '0.1.0' }
    const payload = (data, hasNext = false) => ({ data, stale: false, fetchedAt: Date.now() / 1000, hasNext, warning: null })
    window.isTauri = true
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command, request) => {
        if (command.startsWith('plugin:') || command === 'cancel_request' || command === 'open_github') return null
        if (command === 'bootstrap') return structuredClone(bootstrap)
        if (command === 'local') {
          const args = request.args
          switch (request.operation) {
            case 'settings': bootstrap.settings = structuredClone(args); return null
            case 'notices': return []
            case 'watch': {
              const repo = repos.find(item => item.full_name.toLowerCase() === args.name.toLowerCase())
              if (!repo) throw { code: 'not_found' }
              bootstrap.watchlist.push({ repo, tags: [], added: Date.now() / 1000, collections: [] })
              return null
            }
            case 'unwatch': bootstrap.watchlist = bootstrap.watchlist.filter(item => item.repo.full_name !== args.name); return null
            case 'collection': {
              if (args.name && !args.id) bootstrap.collections.push({ id: 1, name: args.name })
              else if (args.name) bootstrap.collections[0].name = args.name
              else bootstrap.collections = []
              return null
            }
            case 'organize': Object.assign(bootstrap.watchlist[0], { tags: args.tags, collections: args.collections }); return null
            case 'cache_size': return 2048
            case 'rate_status': return {authenticated: false, core: {remaining: 42, limit: 60, resetAt: Date.now() / 1000 + 3600}, search: null, retryAt: null}
            default: throw { code: 'validation' }
          }
        }
        if (command !== 'query') throw { code: 'validation' }
        const { endpoint, args } = request
        if (endpoint === 'profile') {
          const resetAt = Math.floor(Date.now() / 1000) + 600
          if (args.login === 'uncached') throw { code: 'rate_limit', retryAt: resetAt }
          const response = payload({ ...person, login: args.login })
          return request.refresh ? { ...response, stale: true, warning: { code: 'rate_limit', retryAt: resetAt } } : response
        }
        if (endpoint === 'projects') return { repositories: repos, languages: { Rust: 4, Python: 3, TypeScript: 9, Ruby: 2 }, scanned: 6, totalStars: 7650, totalForks: 1140, partial: false, stale: false, warning: null }
        if (endpoint === 'events') return payload(events)
        if (endpoint === 'search') {
          if (args.query === 'offline') throw { code: 'offline' }
          return payload({ total_count: 6, incomplete_results: false, items: args.kind !== 'repositories' ? [person] : args.language ? repos.filter(repo => repo.language === args.language) : repos })
        }
        if (endpoint === 'repository') return payload(repos.find(repo => repo.full_name.toLowerCase() === args.name.toLowerCase()) ?? repos[0])
        if (endpoint === 'section') return payload(args.section === 'languages' ? { Rust: 1400, Python: 900 } : args.section === 'events' ? events.slice(0, 8) : [])
        if (endpoint === 'snapshots') return []
        if (endpoint === 'compare') return args.names.map(name => ({ repo: repos.find(repo => repo.full_name.toLowerCase() === name.toLowerCase()), languages: null, contributors: null, release: null, commits: null, activity: null, errors: [] }))
        throw { code: 'validation' }
      },
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('heading', { name: 'Your GitHub, at a glance.' }).waitFor()
  await page.getByText('7,650', { exact: true }).waitFor()
  await page.locator('.series-chart svg').waitFor()
  const plot = page.locator('.series-chart svg')
  const state = await plot.locator('.plot-bars').evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration))
  assert.ok(state < 0.01, 'Reduced-motion CSS suppresses chart movement')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.locator('html[data-motion=full]').waitFor()
  const duration = await plot.locator('.plot-bars').evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration))
  assert.ok(duration >= 0.3, 'Normal mode animates chart data')
  await page.getByRole('button', { name: '7D', exact: true }).click()
  await page.locator('.series-chart').focus()
  await page.keyboard.press('ArrowRight')
  await page.locator('.chart-tooltip').waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('html[data-motion=reduced]').waitFor()
  await page.getByRole('button', { name: '30D', exact: true }).click()

  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: resolve(output,'overview-light.png') })
  await page.getByRole('button', { name: 'Switch theme', exact: true }).click()
  await page.locator('html[data-theme=dark]').waitFor()
  await page.screenshot({ path: resolve(output,'overview-dark.png') })
  await page.setViewportSize({ width: 780, height: 600 })
  await page.screenshot({ path: resolve(output,'overview-compact.png') })
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true)
  await page.setViewportSize({ width: 1320, height: 880 })
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor()
  await page.getByRole('combobox').fill('fixture/Scope')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'Scope', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Growth', exact: true }).click()
  await page.getByText('Historical data will appear as GitScope collects snapshots.').waitFor()
  await page.getByRole('button', { name: 'Add to watchlist', exact: true }).click()
  await page.getByRole('button', { name: 'Remove from watchlist', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Collections', exact: true }).click()
  await page.getByRole('button', { name: 'New collection', exact: true }).first().click()
  await page.getByLabel('Collection name').fill('Research')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Research', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Watchlist', exact: true }).click()
  await page.getByRole('button', { name: 'Edit tags and collections' }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: /Tags/ }).fill('research, rust')
  await page.getByRole('checkbox', { name: 'Research' }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('rust', { exact: true }).waitFor()
  await page.keyboard.press('Control+2')
  await page.getByRole('heading', { name: 'Find your next repository.' }).waitFor()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('dialog', { name: 'Filters' }).getByLabel('Language').fill('Rust')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await page.getByRole('button', { name: 'Signal', exact: true }).waitFor()
  assert.equal(await page.locator('.repo-card').count(), 2)
  await page.getByRole('textbox', { name: 'Search' }).fill('offline')
  await page.getByText('GitHub could not be reached. Check your connection and retry.').waitFor()
  await page.getByRole('button', { name: 'Developers', exact: true }).first().click()
  const developer = page.locator('main input')
  await developer.fill('fixture')
  await developer.press('Enter')
  await page.getByRole('heading', { name: 'Test owner' }).waitFor()
  await page.keyboard.press('Control+r')
  await page.getByText(/Showing cached data.*request limit was reached/).waitFor()
  await page.getByRole('heading', { name: 'Test owner' }).waitFor()
  await page.getByRole('button', { name: 'Developers', exact: true }).first().click()
  await developer.fill('uncached')
  await developer.press('Enter')
  await page.getByText(/GitHub’s request limit was reached\. Try again after/).waitFor()
  await page.keyboard.press('Control+4')
  await page.getByRole('textbox', { name: 'Repository or GitHub URL' }).fill('fixture/Scope')
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.getByRole('textbox', { name: 'Repository or GitHub URL' }).fill('fixture/Signal')
  await page.getByRole('button', { name: 'Add repository', exact: true }).click()
  await page.getByRole('button', { name: 'Compare projects', exact: true }).click()
  await page.getByRole('table').waitFor()
  assert.equal(await page.getByRole('table').getByRole('columnheader').count(), 3)
  await page.keyboard.press('Control+,')
  await page.getByText('42 / 60', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Use a GitHub token', exact: true }).click()
  await page.locator('input[type=password]').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({state:'hidden'})
  await page.getByLabel('Language', { exact: true }).selectOption('ru')
  await page.getByRole('heading', { name: 'Настрой GitScope под себя.' }).waitFor()
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.deepEqual(uncaught, [])
  console.log('UI integration passed: light/dark, narrow layout, command palette, search filters, cached and uncached profiles after rate limits, quota and token UI, watchlist, collections, comparison, and localization.')
} finally {
  await browser?.close()
  server.close()
}
