import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectionProfileCache } from '../src/main/connection-profiles'
import type { ConnectionProfile } from '../src/shared/model'
import { validateImage } from '../src/main/images'

const directories: string[] = []
afterEach(() => {
    for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-profiles-'))
    directories.push(directory)
    const path = join(directory, 'profiles.json')
    let token = 'private-fixture-token',
        time = 1_000_000
    const load = vi
        .fn<() => Promise<ConnectionProfile>>()
        .mockResolvedValue({ name: 'Journal author', avatarUrl: 'https://github.com/fixture.png' })
    const image = await validateImage(
        await sharp({ create: { width: 128, height: 128, channels: 4, background: '#447766' } })
            .png()
            .toBuffer()
    )
    const download = vi.fn(() => Promise.resolve(image))
    const create = () =>
        new ConnectionProfileCache(
            path,
            () => token,
            load,
            download,
            () => time
        )
    return {
        path,
        load,
        download,
        create,
        setToken: (value: string) => (token = value),
        stale: () => (time += 86_400_001),
        advance: (ms: number) => (time += ms)
    }
}
it('persists a bounded thumbnail and reads a warm profile after restart without network or credentials', async () => {
    const f = await fixture(),
        cache = f.create()
    expect(cache.snapshot()).toEqual({})
    const profile = await cache.refresh('github')
    expect(profile?.name).toBe('Journal author')
    expect(profile?.avatarUrl).toMatch(/^data:image\/webp;base64,/)
    const metadata = await sharp(Buffer.from(profile!.avatarUrl!.split(',')[1], 'base64')).metadata()
    expect(metadata.width).toBe(64)
    expect(metadata.height).toBe(64)
    expect(readFileSync(f.path, 'utf8')).not.toContain('private-fixture-token')
    const restarted = f.create()
    expect(restarted.snapshot().github).toEqual(profile)
    await restarted.refresh('github')
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.download).toHaveBeenCalledTimes(1)
})
it('deduplicates cold requests and keeps stale images when offline', async () => {
    const f = await fixture(),
        cache = f.create()
    const first = cache.refresh('notion'),
        second = cache.refresh('notion')
    expect(await second).toEqual(await first)
    expect(f.load).toHaveBeenCalledTimes(1)
    const previous = cache.snapshot().notion
    f.stale()
    f.load.mockRejectedValueOnce(new Error('offline'))
    expect(await cache.refresh('notion')).toEqual(previous)
    expect(f.create().snapshot().notion).toEqual(previous)
})
it('rejects another account and a late refresh after disconnect, including reuse of the same token', async () => {
    const f = await fixture(),
        cache = f.create()
    await cache.refresh('github')
    f.setToken('different-account')
    expect(cache.snapshot().github).toBeUndefined()
    let finish!: () => void
    f.load.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = () => resolve({ name: 'Old account', avatarUrl: undefined })
            })
    )
    const pending = cache.refresh('github')
    cache.clear('github')
    finish()
    expect(await pending).toBeUndefined()
    expect(cache.snapshot().github).toBeUndefined()
    expect(f.create().snapshot().github).toBeUndefined()
    expect((await cache.refresh('github'))?.name).toBe('Journal author')
})
it('keeps the last image on a failed download, retries soon, and removes an explicitly absent avatar', async () => {
    const f = await fixture(),
        cache = f.create()
    await cache.refresh('notion')
    f.stale()
    const old = cache.snapshot().notion?.avatarUrl
    f.download.mockRejectedValueOnce(new Error('image unavailable'))
    expect((await cache.refresh('notion'))?.avatarUrl).toBe(old)
    f.advance(300_001)
    f.load.mockResolvedValueOnce({ name: 'No avatar' })
    expect((await cache.refresh('notion'))?.avatarUrl).toBeUndefined()
    expect(f.create().snapshot().notion?.avatarUrl).toBeUndefined()
})
it('treats corrupt cache storage and missing images as optional profile data', async () => {
    const f = await fixture()
    writeFileSync(f.path, 'broken json')
    const cache = f.create()
    expect(cache.snapshot()).toEqual({})
    f.download.mockRejectedValueOnce(new Error('unavailable'))
    expect(await cache.refresh('github')).toEqual({ name: 'Journal author' })
    f.setToken('')
    expect(cache.snapshot()).toEqual({})
})
