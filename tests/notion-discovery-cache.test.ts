import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NotionPage } from '../src/shared/model'
import { NotionDiscoveryCache } from '../src/main/notion-discovery-cache'

const directories: string[] = []
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const pages: NotionPage[] = [
    { kind: 'page', id: 'journal', title: 'Work journal', url: 'https://www.notion.so/journal' }
]
function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-notion-cache-'))
    directories.push(directory)
    const path = join(directory, 'notion-pages.json')
    let time = 1000000
    return {
        path,
        create: () => new NotionDiscoveryCache(path, () => time),
        stale: () => {
            time += 300001
        }
    }
}
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

it('persists complete metadata across restart and reuses fresh results without storing credentials', async () => {
    const f = fixture(),
        cache = f.create(),
        load = vi.fn(() => Promise.resolve(pages))
    expect(await cache.pages('secret-token', load)).toEqual(pages)
    expect(await f.create().pages('secret-token', load)).toEqual(pages)
    expect(load).toHaveBeenCalledTimes(1)
    expect(readFileSync(f.path, 'utf8')).not.toContain('secret-token')
})

it('returns a stable stale snapshot immediately and makes refreshed data available only on next open', async () => {
    const f = fixture(),
        cache = f.create(),
        update = deferred<NotionPage[]>()
    await cache.pages('token', () => Promise.resolve(pages))
    f.stale()
    const snapshot = await cache.pages('token', () => update.promise)
    expect(snapshot).toEqual(pages)
    const changed = [{ ...pages[0], title: 'Renamed journal' }]
    update.resolve(changed)
    await vi.waitFor(() => expect(JSON.parse(readFileSync(f.path, 'utf8')).pages[0].title).toBe('Renamed journal'))
    expect(snapshot[0].title).toBe('Work journal')
    expect(await cache.pages('token', () => Promise.reject(new Error('No network expected')))).toEqual(changed)
})

it('keeps persisted results on a background failure and shares an overlapping cold load', async () => {
    const f = fixture(),
        cache = f.create(),
        initial = deferred<NotionPage[]>(),
        load = vi.fn(() => initial.promise)
    const first = cache.pages('token', load),
        second = cache.pages('token', load)
    initial.resolve(pages)
    expect(await first).toEqual(await second)
    expect(load).toHaveBeenCalledTimes(1)
    f.stale()
    expect(await cache.pages('token', () => Promise.reject(new Error('Offline')))).toEqual(pages)
    await Promise.resolve()
    expect(JSON.parse(readFileSync(f.path, 'utf8')).pages).toEqual(pages)
})

it('never reuses another connection cache and prevents canceled late loads from restoring it', async () => {
    const f = fixture(),
        cache = f.create(),
        late = deferred<NotionPage[]>()
    await cache.pages('first-token', () => Promise.resolve(pages))
    let signal: AbortSignal | undefined
    const pending = cache.pages('other-token', (current) => {
        signal = current
        return late.promise
    })
    await Promise.resolve()
    cache.clear()
    expect(signal?.aborted).toBe(true)
    const failure = expect(pending).rejects.toThrow()
    late.resolve([{ ...pages[0], title: 'Other account' }])
    await failure
    const load = vi.fn(() => Promise.resolve([]))
    expect(await f.create().pages('first-token', load)).toEqual([])
    expect(load).toHaveBeenCalledTimes(1)
})

it('treats corrupt files as a miss and caches a confirmed empty result', async () => {
    const f = fixture()
    writeFileSync(f.path, '{broken')
    const cache = f.create(),
        load = vi.fn(() => Promise.resolve([]))
    expect(await cache.pages('token', load)).toEqual([])
    expect(await cache.pages('token', load)).toEqual([])
    expect(load).toHaveBeenCalledTimes(1)
})

it('adds a newly confirmed page without mutating the picker snapshot', async () => {
    const f = fixture(),
        cache = f.create()
    const snapshot = await cache.pages('token', () => Promise.resolve(pages))
    const created: NotionPage = { kind: 'page', id: 'new', title: 'Team journal', url: '' }
    cache.remember('token', created)
    expect(snapshot).toEqual(pages)
    expect(await cache.pages('token', () => Promise.reject(new Error('No network expected')))).toEqual([
        ...pages,
        created
    ])
})
