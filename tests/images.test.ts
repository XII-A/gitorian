import { journalState } from './database-fixtures'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { JournalDatabase } from '../src/main/journal-database'
import { validateImage, downloadImage } from '../src/main/images'
import { imageIds, imageLimits } from '../src/shared/images'
import { initialState } from '../src/shared/model'
vi.mock('node:dns/promises', () => ({
    lookup: vi.fn((host: string) =>
        Promise.resolve([{ address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }])
    )
}))
const directories: string[] = []
afterEach(() => {
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
    const bytes = await picture()
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(bytes)))
    expect((await downloadImage('https://files.example/image', fetcher)).bytes).toEqual(bytes)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'manual' })
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined()
    await expect(downloadImage('https://private.example/image', fetcher)).rejects.toThrow('public')
    fetcher.mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://private.example/image' } }))
    )
    await expect(downloadImage('https://files.example/image', fetcher)).rejects.toThrow('public')
    fetcher.mockImplementation(() =>
        Promise.resolve(new Response('x', { headers: { 'content-length': String(imageLimits.bytes + 1) } }))
    )
    await expect(downloadImage('https://files.example/image', fetcher)).rejects.toThrow('5 MB')
})
