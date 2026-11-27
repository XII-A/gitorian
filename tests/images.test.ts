import { journalState } from './database-fixtures'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { JournalDatabase } from '../src/main/journal-database'
import { validateImage, downloadImage } from '../src/main/images'
import { imageIds, imageLimits } from '../src/shared/images'
import { initialState } from '../src/shared/model'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const directories: string[] = []
afterEach(() => {
    server.resetHandlers()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function location() {
    const directory = mkdtempSync(join(tmpdir(), 'journal-images-'))
    directories.push(directory)
    return join(directory, 'journal.sqlite')
}
const picture = (format: 'png' | 'jpeg' | 'webp' = 'png') =>
    sharp({ create: { width: 24, height: 12, channels: 3, background: '#305070' } })
        .toFormat(format)
        .toBuffer()
it('keeps a self-contained SVG vector through validation and backup restore', async () => {
    const bytes = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><style>.box {fill: teal}</style><rect class="box" width="160" height="80"/></svg>'
    )
    const image = await validateImage(bytes)
    expect(image.mime).toBe('image/svg+xml')
    expect(Buffer.from(image.bytes)).toEqual(bytes)
    const store = await JournalDatabase.open(location())
    try {
        const id = await store.importImage(bytes)
        await store.restore(await store.export())
        expect((await store.image(id))?.mime).toBe('image/svg+xml')
    } finally {
        await store.close()
    }
})
it.each([
    '<script>alert(1)</script>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
    '<use href="https://example.com/image.svg#x"/>',
    '<rect width="20" height="20" onclick="alert(1)"/>',
    '<style>@import "https://example.com/styles.css";</style>',
    '<rect fill="url(https://example.com/image.svg)"/>',
    '<animate attributeName="width" to="40"/>',
    '<rect fill="u&#92;72l(https://example.com/image.svg)"/>'
])('rejects active or externally linked SVG content: %s', async (content) => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">${content}</svg>`
    await expect(validateImage(Buffer.from(source))).rejects.toThrow('self-contained SVG')
})
it.each(['png', 'jpeg', 'webp'] as const)('validates and retains original %s bytes', async (format) => {
    const bytes = await picture(format)
    const image = await validateImage(bytes)
    expect(image).toMatchObject({ mime: `image/${format}`, width: 24, height: 12 })
    expect(Buffer.from(image.bytes)).toEqual(bytes)
    expect((await validateImage(bytes)).id).toBe(image.id)
})
it('rejects malformed, oversized, unsupported and excessive-pixel images', async () => {
    await expect(validateImage(Buffer.from('not an image'))).rejects.toThrow('valid')
    await expect(validateImage(new Uint8Array(imageLimits.bytes + 1))).rejects.toThrow('5 MB')
    await expect(
        validateImage(
            await sharp(await picture())
                .gif()
                .toBuffer()
        )
    ).rejects.toThrow('valid')
    const huge = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } })
        .png()
        .toBuffer()
    await expect(validateImage(huge)).rejects.toThrow('40 million')
    const corrupt = (await picture()).subarray(0, 45)
    await expect(validateImage(corrupt)).rejects.toThrow('valid')
})
it('persists deduplicated images outside state and restores image backups', async () => {
    const path = location()
    let store = await JournalDatabase.open(path)
    try {
        const bytes = await picture()
        const id = await store.importImage(bytes)
        expect(await store.importImage(bytes)).toBe(id)
        const body = { type: 'doc', content: [{ type: 'image', attrs: { assetId: id, alt: 'New design' } }] }
        await store.saveSettings({ ...store.config.settings, template: body })
        const draft = await store.createDraft('2026-10-26')
        const history = await store.entryHistory('')
        expect(history.items).toHaveLength(1)
        expect(imageIds((await store.entry(history.items[0].id))!.body)).toEqual([id])
        expect((await store.entry(history.items[0].id))?.week).toBe(draft.week)
        expect(JSON.stringify(await store.readWorkspace())).not.toContain(bytes.toString('base64'))
        const backup = await store.export()
        expect(JSON.parse(backup).images).toHaveLength(1)
        await store.close()
        store = await JournalDatabase.open(path)
        expect(Buffer.from((await store.image(id))!.bytes)).toEqual(bytes)
        await store.restore(backup)
        expect(imageIds((await journalState(store)).settings.template)).toEqual([id])
        expect(Buffer.from((await store.image(id))!.bytes)).toEqual(bytes)
        const oldEpoch = (await journalState(store)).restoreId
        await store.restore(JSON.stringify({ backupVersion: 3, state: initialState(), images: [] }))
        expect(await store.image(id)).toBeUndefined()
        await expect(store.importImage(bytes, oldEpoch)).rejects.toThrow('restored')
    } finally {
        await store.close()
    }
})
it('validates references and hashes before restore and rolls back image and state replacement together', async () => {
    const path = location()
    const store = await JournalDatabase.open(path)
    const db = new DatabaseSync(path)
    try {
        const id = await store.importImage(await picture())
        await store.saveSettings({
            ...store.config.settings,
            template: { type: 'doc', content: [{ type: 'image', attrs: { assetId: id, alt: '' } }] }
        })
        const before = await journalState(store)
        const backup = JSON.parse(await store.export())
        backup.images[0].id = 'a'.repeat(64)
        await expect(store.restore(JSON.stringify(backup))).rejects.toThrow('Invalid')
        backup.images = []
        await expect(store.restore(JSON.stringify(backup))).rejects.toThrow('missing')
        db.exec("CREATE TRIGGER reject_restore BEFORE UPDATE ON journal BEGIN SELECT RAISE(ABORT,'disk failure'); END;")
        await expect(
            store.restore(JSON.stringify({ backupVersion: 3, state: initialState(), images: [] }))
        ).rejects.toThrow('could not be saved')
        expect(await journalState(store)).toEqual(before)
        expect(await store.image(id)).toBeDefined()
        db.exec('DROP TRIGGER reject_restore')
        const reopened = await JournalDatabase.open(path)
        expect(imageIds((await journalState(reopened)).settings.template)).toEqual([id])
        await reopened.close()
    } finally {
        db.close()
        await store.close()
    }
})
it('downloads bounded images without credentials and rejects unsafe redirect destinations', async () => {
    // IP literals exercise the real address check without depending on public DNS.
    const publicUrl = 'https://93.184.216.34/image'
    const privateUrl = 'https://127.0.0.1/image'
    const bytes = await picture()
    const requests: Request[] = []
    server.use(
        http.get(publicUrl, ({ request }) => {
            requests.push(request)
            return new Response(new Uint8Array(bytes))
        })
    )
    expect((await downloadImage(publicUrl, fetch)).bytes).toEqual(bytes)
    expect(requests[0].credentials).toBe('omit')
    expect(requests[0].redirect).toBe('manual')
    expect(requests[0].headers.has('Authorization')).toBe(false)
    await expect(downloadImage(privateUrl, fetch)).rejects.toThrow('public')
    server.use(
        http.get(publicUrl, () => {
            return new Response(null, { status: 302, headers: { location: privateUrl } })
        })
    )
    await expect(downloadImage(publicUrl, fetch)).rejects.toThrow('public')
    // Keep the unread response body at the transport seam, where the caller owns cancellation.
    const oversized = new Response('x', { headers: { 'content-length': String(imageLimits.bytes + 1) } })
    await expect(downloadImage(publicUrl, () => Promise.resolve(oversized))).rejects.toThrow('5 MB')
})
