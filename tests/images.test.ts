import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { Store } from '../src/main/store'
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
    const store = new Store(location())
    try {
        const id = await store.importImage(bytes)
        await store.restore(store.export())
        expect(store.image(id)?.mime).toBe('image/svg+xml')
    } finally {
        store.close()
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

it('persists deduplicated images outside state and restores image backups and legacy journals', async () => {
    const path = location()
    let store = new Store(path)
    try {
        const bytes = await picture()
        const id = await store.importImage(bytes)
        expect(await store.importImage(bytes)).toBe(id)
        const body = { type: 'doc', content: [{ type: 'image', attrs: { assetId: id, alt: 'New design' } }] }
        store.state.settings.template = body
        store.persist()
        expect(JSON.stringify(store.snapshot())).not.toContain(bytes.toString('base64'))
        const backup = store.export()
        expect(JSON.parse(backup).images).toHaveLength(1)
        store.close()
        store = new Store(path)
        expect(Buffer.from(store.image(id)!.bytes)).toEqual(bytes)
        await store.restore(backup)
        expect(imageIds(store.state.settings.template)).toEqual([id])
        expect(Buffer.from(store.image(id)!.bytes)).toEqual(bytes)
        const oldEpoch = store.state.restoreId
        await store.restore(JSON.stringify(initialState()))
        expect(store.image(id)).toBeUndefined()
        await expect(store.importImage(bytes, oldEpoch)).rejects.toThrow('changed')
    } finally {
        store.close()
    }
})

it('validates references and hashes before restore and rolls back image and state replacement together', async () => {
    const path = location()
    const store = new Store(path)
    const db = new DatabaseSync(path)
    try {
        const id = await store.importImage(await picture())
        store.state.settings.template = { type: 'doc', content: [{ type: 'image', attrs: { assetId: id, alt: '' } }] }
        store.persist()
        const before = store.state
        const backup = JSON.parse(store.export())
        backup.images[0].id = 'a'.repeat(64)
        await expect(store.restore(JSON.stringify(backup))).rejects.toThrow('Invalid')
        backup.images = []
        await expect(store.restore(JSON.stringify(backup))).rejects.toThrow('missing')
        db.exec(
            "CREATE TRIGGER reject_restore BEFORE INSERT ON state_parts BEGIN SELECT RAISE(ABORT,'disk failure'); END;"
        )
        await expect(store.restore(JSON.stringify(initialState()))).rejects.toThrow('disk failure')
        expect(store.state).toBe(before)
        expect(store.image(id)).toBeDefined()
        db.exec('DROP TRIGGER reject_restore')
        store.persist()
        await store.flush()
        const reopened = new Store(path)
        expect(imageIds(reopened.state.settings.template)).toEqual([id])
        reopened.close()
    } finally {
        db.close()
        store.close()
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
