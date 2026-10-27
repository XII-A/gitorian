import { DurabilityError } from '../src/main/durability-error'
import { HttpError, TransportError } from '../src/main/http'
import { run } from './effect-fixtures'
import { Effect, ManagedRuntime } from 'effect'
import { journalLayer } from '../src/main/journal-layer'
import { Notion } from '../src/main/notion'
import { JournalPublishing } from '../src/main/journal-publishing'
import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/main/store'
import { validateImage, UnsupportedImageError } from '../src/main/images'
import { toNotion } from '../src/shared/notion-format'
import type { NotionBlock } from '../src/shared/notion-format'
import type { State } from '../src/shared/model'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close()
})
async function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'notion-images-'))
    const store = new Store(join(directory, 'journal.sqlite'))
    cleanup.push(() => {
        store.close()
        rmSync(directory, { recursive: true, force: true })
    })
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#557799' } })
        .png()
        .toBuffer()
    const id = await store.importImage(bytes)
    const uploads = new Map<string, Uint8Array>()
    let counter = 0
    let blocks: NotionBlock[] = []
    const page = {
        id: 'page',
        url: 'https://notion.so/page',
        created_time: new Date().toISOString(),
        properties: { title: { title: [{ text: { content: 'Design' } }] } }
    }
    const remote = { failUpload: false, networkUpload: false, loseCreate: false, wrongImage: false, uploadStatus: 400 }
    const attach = (items: NotionBlock[]): NotionBlock[] =>
        items.map((block) => {
            const data = block[block.type] as Record<string, unknown>
            return {
                ...block,
                id: `block-${++counter}`,
                has_children: Array.isArray(data.children),
                [block.type]:
                    block.type === 'image'
                        ? {
                              type: 'file',
                              file: {
                                  url: `https://files.example/temporary/${
                                      (
                                          data.file_upload as {
                                              id: string
                                          }
                                      ).id
                                  }?signed=${counter}`
                              },
                              caption: data.caption
                          }
                        : {
                              ...data,
                              ...(Array.isArray(data.children)
                                  ? { children: attach(data.children as NotionBlock[]) }
                                  : {})
                          }
            }
        })
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
        const url = input instanceof Request ? input.url : String(input)
        const path = new URL(url).pathname.replace('/v1/', '')
        const json = (value: unknown) => new Response(JSON.stringify(value))
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
        if (path === 'file_uploads') return json({ id: `upload-${++counter}` })
        if (/file_uploads\/.*\/send$/.test(path)) {
            if (remote.networkUpload) throw new Error('Upload connection lost')
            if (remote.failUpload) return new Response('{}', { status: remote.uploadStatus })
            expect(new Headers(init.headers).get('Content-Type')).toBeNull()
            const file = (init.body as FormData).get('file') as File
            uploads.set(path.split('/')[1], new Uint8Array(await file.arrayBuffer()))
            return json({ status: 'uploaded', expiry_time: new Date(Date.now() + 3600000).toISOString() })
        }
        if (path.startsWith('file_uploads/')) return json({ status: 'uploaded', expiry_time: null })
        if (path === 'pages' && init.method === 'POST') {
            blocks = attach(body.children)
            if (remote.loseCreate) throw new Error('Lost create response')
            return json(page)
        }
        if (path === 'pages/page') return json(page)
        if (path === 'blocks/parent/children')
            return json({
                results: [{ type: 'child_page', id: 'page', child_page: { title: 'Design' } }],
                has_more: false
            })
        if (init.method === 'DELETE') {
            blocks = blocks.filter((item) => item.id !== path.split('/')[1])
            return json({})
        }
        if (path === 'blocks/page/children') {
            if (init.method === 'PATCH') {
                blocks.push(...attach(body.children))
                return json({})
            }
            return json({ results: blocks, has_more: false })
        }
        for (const block of blocks) {
            const data = block[block.type] as {
                children?: NotionBlock[]
            }
            if (path === `blocks/${block.id}/children`) return json({ results: data.children, has_more: false })
        }
        throw new Error(`Unexpected request ${path}`)
    })
    const download = vi.fn(async (url: string) => {
        if (remote.wrongImage) return validateImage(await sharp(bytes).negate().png().toBuffer())
        const upload = uploads.get(new URL(url).pathname.split('/').at(-1)!)!
        return validateImage(upload)
    })
    const save: State['saves'][number] = {
        id: 'save',
        draftId: 'draft',
        status: 'pending',
        marker: 'marker',
        title: 'Design',
        body: {
            type: 'doc',
            content: [
                { type: 'image', attrs: { assetId: id, alt: 'System diagram' } },
                { type: 'image', attrs: { assetId: id, alt: '' } }
            ]
        },
        selections: [],
        destination: { kind: 'page', id: 'parent', titleProperty: '', dateProperty: '' },
        createdAt: page.created_time
    }
    store.state.settings.destination = save.destination
    store.state.drafts.push({
        id: 'draft',
        week: '2026-10-19',
        title: save.title,
        body: save.body,
        selections: [],
        updatedAt: save.createdAt
    })
    const runtime = ManagedRuntime.make(
        journalLayer({
            store,
            fetcher,
            imageDownload: download,
            githubCredential: () => '',
            setGitHubCredential: vi.fn(),
            notionToken: () => Effect.succeed('private-token'),
            connections: () => ({ github: false, notion: true, protectedStorage: false })
        })
    )
    cleanup.push(() => runtime.dispose())
    const notion = await runtime.runPromise(Notion)
    const publishing = await runtime.runPromise(JournalPublishing)
    return {
        store,
        id,
        bytes,
        get save() {
            return store.state.saves.at(-1)!
        },
        notion,
        publishing,
        fetcher,
        download,
        remote
    }
}
it('uploads once for repeated images and round-trips bytes/descriptions through temporary URLs', async () => {
    const app = await setup()
    const checkpoint = vi.spyOn(app.store, 'flush')
    const original = structuredClone(app.store.state.drafts[0].body)
    await run(app.publishing.publish('draft'))
    const entry = app.store.state.entries[0]
    expect(entry.body).toEqual(original)
    expect(
        app.fetcher.mock.calls.filter(([url]) => (url instanceof Request ? url.url : String(url)).endsWith('/send'))
    ).toHaveLength(1)
    expect(app.save.imageUploads?.[app.id]).toBeDefined()
    expect(checkpoint).toHaveBeenCalled()
    const refreshed = await run(app.notion.refreshEntry('page'))
    expect(toNotion(refreshed.body)).toEqual(toNotion(original))
    expect(app.download).toHaveBeenCalledTimes(2)
    expect(app.save.body).toEqual(original)
    expect(
        app.fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get('Notion-Version') === '2025-09-03')
    ).toBe(true)
    app.save.status = 'unknown'
    await run(app.publishing.reconcile(app.save.id))
    expect(app.store.state.entries[0].id).toBe('page')
    app.save.status = 'unknown'
    app.remote.wrongImage = true
    await expect(run(app.publishing.reconcile(app.save.id))).rejects.toThrow('differs')
})
it('finds a complete image-bearing page after a lost create response without duplicating it', async () => {
    const app = await setup()
    app.remote.loseCreate = true
    await expect(run(app.publishing.publish('draft'))).rejects.toThrow()
    expect(app.save.entryId).toBeUndefined()
    const restoredSave = structuredClone(app.save)
    app.store.state.saves[0] = restoredSave
    await run(app.publishing.reconcile(restoredSave.id))
    expect(app.store.state.entries[0].id).toBe('page')
    expect(
        app.fetcher.mock.calls.filter(
            ([url, init]) =>
                (url instanceof Request ? url.url : String(url)).endsWith('/pages') && init?.method === 'POST'
        )
    ).toHaveLength(1)
})
it('preflights expired image uploads before deleting existing writing during an update', async () => {
    const app = await setup()
    await run(app.publishing.publish('draft'))
    app.save.status = 'unknown'
    app.save.updateExisting = true
    app.save.imageUploads![app.id].expiresAt = new Date(0).toISOString()
    app.remote.failUpload = true
    app.fetcher.mockClear()
    await expect(run(app.publishing.reconcile(app.save.id))).rejects.toThrow()
    expect(app.fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    app.remote.failUpload = false
    await run(app.publishing.reconcile(app.save.id))
    expect(app.fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    expect(toNotion((await run(app.notion.refreshEntry('page'))).body)).toEqual(toNotion(app.save.body))
})
it('represents unsupported remote media explicitly and never confirms it as the expected image', async () => {
    const app = await setup()
    await run(app.publishing.publish('draft'))
    app.save.status = 'unknown'
    app.download.mockRejectedValue(new UnsupportedImageError('Unsupported image'))
    const entry = await run(app.notion.refreshEntry('page'))
    expect(JSON.stringify(entry.body)).toContain('Unsupported content: image')
    await expect(run(app.publishing.reconcile(app.save.id))).rejects.toThrow('differs')
    app.download.mockRejectedValue(new Error('Download unavailable'))
    await expect(run(app.notion.refreshEntry('page'))).rejects.toThrow('Download unavailable')
})
it.each(['network', 'server'] as const)(
    'preserves preflight %s failure identity and permits a safe retry',
    async (kind) => {
        const app = await setup()
        app.remote.networkUpload = kind === 'network'
        app.remote.failUpload = kind === 'server'
        app.remote.uploadStatus = 500
        const failure = await run(app.publishing.publish('draft')).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(kind === 'network' ? TransportError : HttpError)
        if (failure instanceof HttpError) expect(failure.status).toBe(500)
        if (failure instanceof TransportError) expect(failure.cause).toBeInstanceOf(Error)
        expect(app.store.state.saves[0].status).toBe('failed')
        expect(app.store.state.saves[0].error).toContain('page has not been changed')
        app.remote.networkUpload = false
        app.remote.failUpload = false
        await run(app.publishing.publish('draft'))
        expect(app.store.state.saves.at(-1)?.status).toBe('confirmed')
    }
)
it('preserves an image checkpoint durability failure before page dispatch', async () => {
    const app = await setup()
    const cause = new Error('Image progress checkpoint unavailable')
    const persist = app.store.persist.bind(app.store)
    let unavailable = true
    vi.spyOn(app.store, 'persist').mockImplementation(() => {
        if (unavailable && app.store.state.saves.some((save) => save.imageUploads?.[app.id])) {
            unavailable = false
            throw cause
        }
        return persist()
    })
    const failure = await run(app.publishing.publish('draft')).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DurabilityError)
    if (failure instanceof DurabilityError) expect(failure.cause).toBe(cause)
    expect(app.store.state.saves[0].status).toBe('failed')
    expect(
        app.fetcher.mock.calls.some(([url]) => (url instanceof Request ? url.url : String(url)).endsWith('/pages'))
    ).toBe(false)
    unavailable = false
    await run(app.publishing.publish('draft'))
    expect(app.store.state.saves.at(-1)?.status).toBe('confirmed')
})
