import { journalState, seedJournal, editPublication } from './database-fixtures'
import { DurabilityError } from '../src/main/durability-error'
import { HttpError, TransportError } from '../src/main/http'
import { run } from './effect-fixtures'
import { Effect, ManagedRuntime } from 'effect'
import { journalLayer } from '../src/main/journal-layer'
import { Notion } from '../src/main/notion'
import { JournalPublishing } from '../src/main/journal-publishing'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JournalDatabase } from '../src/main/journal-database'
import { downloadImage } from '../src/main/images'
import { toNotion } from '../src/shared/notion-format'
import type { NotionBlock } from '../src/shared/notion-format'
import type { State } from '../src/shared/model'
const endpoint = 'https://api.notion.com/v1'
const filesOrigin = 'https://93.184.216.34'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
    try {
        for (const close of cleanup.splice(0).reverse()) await close()
    } finally {
        server.resetHandlers()
    }
})
async function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'notion-images-'))
    const dbPath = join(directory, 'journal.sqlite')
    const store = await JournalDatabase.open(dbPath)
    cleanup.push(async () => {
        await store.close()
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
    const remote = {
        failUpload: false,
        networkUpload: false,
        loseCreate: false,
        wrongImage: false,
        uploadStatus: 400,
        download: 'available' as 'available' | 'unsupported' | 'unavailable'
    }
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
                                  url: `${filesOrigin}/temporary/${
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
    const requests: Request[] = []
    const downloaded: string[] = []
    server.use(
        http.all(endpoint + '/*', async ({ request }) => {
            requests.push(request)
            const path = new URL(request.url).pathname.replace('/v1/', '')
            const json = (value: unknown) => Response.json(value)
            if (path === 'file_uploads') return json({ id: `upload-${++counter}` })
            if (/file_uploads\/.*\/send$/.test(path)) {
                if (remote.networkUpload) return Response.error()
                if (remote.failUpload) return new Response('{}', { status: remote.uploadStatus })
                const file = (await request.formData()).get('file')
                if (!(file instanceof File)) return Response.json({}, { status: 400 })
                uploads.set(path.split('/')[1], new Uint8Array(await file.arrayBuffer()))
                return json({ status: 'uploaded', expiry_time: new Date(Date.now() + 3600000).toISOString() })
            }
            if (path.startsWith('file_uploads/')) return json({ status: 'uploaded', expiry_time: null })
            if (path === 'pages' && request.method === 'POST') {
                const { children } = (await request.json()) as { children: NotionBlock[] }
                blocks = attach(children)
                if (remote.loseCreate) return Response.error()
                return json(page)
            }
            if (path === 'pages/page') return json(page)
            if (path === 'blocks/parent/children')
                return json({
                    results: [{ type: 'child_page', id: 'page', child_page: { title: 'Design' } }],
                    has_more: false
                })
            if (request.method === 'DELETE') {
                blocks = blocks.filter((item) => item.id !== path.split('/')[1])
                return json({})
            }
            if (path === 'blocks/page/children') {
                if (request.method === 'PATCH') {
                    const { children } = (await request.json()) as { children: NotionBlock[] }
                    blocks.push(...attach(children))
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
            return Response.json({}, { status: 500 })
        }),
        http.get(filesOrigin + '/temporary/:id', async ({ request, params }) => {
            downloaded.push(request.url)
            if (request.headers.has('Authorization')) return Response.json({}, { status: 400 })
            if (remote.download === 'unsupported') return new Response('not an image')
            if (remote.download === 'unavailable') return Response.json({}, { status: 503 })
            const upload = remote.wrongImage
                ? await sharp(bytes).negate().png().toBuffer()
                : uploads.get(String(params.id))
            return upload ? new Response(new Uint8Array(upload)) : Response.json({}, { status: 404 })
        })
    )
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
    await store.setDestination(save.destination)
    const seeded = await journalState(store)
    seeded.drafts.push({
        version: 1,
        id: 'draft',
        week: '2026-10-19',
        title: save.title,
        body: save.body,
        selections: [],
        updatedAt: save.createdAt
    })
    await seedJournal(store, seeded)
    const secrets = new Map<string, string>()
    const runtime = ManagedRuntime.make(
        journalLayer({
            store,
            imageDownload: (url) => downloadImage(url, fetch),
            vault: {
                get: (key) => secrets.get(key) ?? '',
                set: (key, value) => {
                    if (value) secrets.set(key, value)
                    else secrets.delete(key)
                },
                protected: () => false
            },
            notionToken: () => Effect.succeed('private-token'),
            connections: () => ({ remote: false, notion: true, protectedStorage: false })
        })
    )
    cleanup.push(() => runtime.dispose())
    const notion = await runtime.runPromise(Notion)
    const publishing = await runtime.runPromise(JournalPublishing)
    return {
        store,
        id,
        bytes,
        save: async () => (await journalState(store)).saves.at(-1)!,
        notion,
        publishing,
        dbPath,
        requests,
        downloaded,
        remote
    }
}
it('uploads once for repeated images and round-trips bytes/descriptions through temporary URLs', async () => {
    const app = await setup()
    const original = structuredClone((await journalState(app.store)).drafts[0].body)
    await run(app.publishing.publish('draft'))
    const entry = (await journalState(app.store)).entries[0]
    expect(entry.body).toEqual(original)
    expect(app.requests.filter((request) => request.url.endsWith('/send'))).toHaveLength(1)
    expect((await app.save()).imageUploads?.[app.id]).toBeDefined()
    const refreshed = await run(app.notion.refreshEntry('page'))
    expect(toNotion(refreshed.body)).toEqual(toNotion(original))
    expect(app.downloaded).toHaveLength(2)
    expect((await app.save()).body).toEqual(original)
    expect(app.requests.every((request) => request.headers.get('Notion-Version') === '2025-09-03')).toBe(true)
    await editPublication(app.store, (save) => {
        save.status = 'unknown'
    })
    await run(app.publishing.reconcile((await app.save()).id))
    expect((await journalState(app.store)).entries[0].id).toBe('page')
    await editPublication(app.store, (save) => {
        save.status = 'unknown'
    })
    app.remote.wrongImage = true
    await expect(run(app.publishing.reconcile((await app.save()).id))).rejects.toThrow('differs')
})
it('finds a complete image-bearing page after a lost create response without duplicating it', async () => {
    const app = await setup()
    app.remote.loseCreate = true
    await expect(run(app.publishing.publish('draft'))).rejects.toThrow()
    expect((await app.save()).entryId).toBeUndefined()
    const restoredSave = structuredClone(await app.save())
    await editPublication(app.store, (save) => {
        Object.assign(save, restoredSave)
    })
    await run(app.publishing.reconcile(restoredSave.id))
    expect((await journalState(app.store)).entries[0].id).toBe('page')
    expect(app.requests.filter((request) => request.url.endsWith('/pages') && request.method === 'POST')).toHaveLength(
        1
    )
})
it('preflights expired image uploads before deleting existing writing during an update', async () => {
    const app = await setup()
    await run(app.publishing.publish('draft'))
    await editPublication(app.store, (save) => {
        save.status = 'unknown'
    })
    await editPublication(app.store, (save) => {
        save.updateExisting = true
    })
    await editPublication(app.store, (save) => {
        save.imageUploads![app.id].expiresAt = new Date(0).toISOString()
    })
    app.remote.failUpload = true
    app.requests.length = 0
    await expect(run(app.publishing.reconcile((await app.save()).id))).rejects.toThrow()
    expect(app.requests.some((request) => request.method === 'DELETE')).toBe(false)
    app.remote.failUpload = false
    await run(app.publishing.reconcile((await app.save()).id))
    expect(app.requests.some((request) => request.method === 'DELETE')).toBe(true)
    expect(toNotion((await run(app.notion.refreshEntry('page'))).body)).toEqual(toNotion((await app.save()).body))
})
it('represents unsupported remote media explicitly and never confirms it as the expected image', async () => {
    const app = await setup()
    await run(app.publishing.publish('draft'))
    await editPublication(app.store, (save) => {
        save.status = 'unknown'
    })
    app.remote.download = 'unsupported'
    const entry = await run(app.notion.refreshEntry('page'))
    expect(JSON.stringify(entry.body)).toContain('Unsupported content: image')
    await expect(run(app.publishing.reconcile((await app.save()).id))).rejects.toThrow('differs')
    app.remote.download = 'unavailable'
    await expect(run(app.notion.refreshEntry('page'))).rejects.toThrow(/retrieve|image/i)
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
        expect((await journalState(app.store)).saves[0].status).toBe('failed')
        expect((await journalState(app.store)).saves[0].error).toContain('page has not been changed')
        app.remote.networkUpload = false
        app.remote.failUpload = false
        await run(app.publishing.publish('draft'))
        expect((await journalState(app.store)).saves.at(-1)?.status).toBe('confirmed')
    }
)
it('preserves an image checkpoint durability failure before page dispatch', async () => {
    const app = await setup()
    const db = new DatabaseSync(app.dbPath)
    try {
        db.exec(
            'CREATE TRIGGER reject_image_checkpoint BEFORE UPDATE ON publication_attempts ' +
                "WHEN NEW.status = 'pending' AND NEW.imageUploads IS NOT NULL AND NEW.imageUploads != '{}' " +
                "BEGIN SELECT RAISE(ABORT, 'image progress checkpoint unavailable'); END"
        )
        const failure = await run(app.publishing.publish('draft')).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(DurabilityError)
        expect((await journalState(app.store)).saves[0].status).toBe('failed')
        expect(app.requests.some((request) => request.url.endsWith('/pages'))).toBe(false)
        db.exec('DROP TRIGGER reject_image_checkpoint')
        await run(app.publishing.publish('draft'))
        expect((await journalState(app.store)).saves.at(-1)?.status).toBe('confirmed')
    } finally {
        db.close()
    }
})
