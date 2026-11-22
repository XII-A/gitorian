import { deferred } from './deferred'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { ConnectionProfileCache } from '../src/main/connection-profiles'
import { downloadImage } from '../src/main/images'
import { notionClient, run, transportClient } from './effect-fixtures'

const profileUrl = 'https://api.notion.com/v1/users/me'
// An IP literal exercises the real address check and keeps DNS out of the fixture.
const imageUrl = 'https://93.184.216.34/avatar.png'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

const directories: string[] = []
afterEach(() => {
    server.resetHandlers()
    for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-profiles-'))
    directories.push(directory)
    const path = join(directory, 'profiles.json')
    let token = 'private-fixture-token'
    let time = 1_000_000
    const requests: string[] = []
    const image = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#447766' } })
        .png()
        .toBuffer()
    server.use(
        http.get(profileUrl, () => {
            requests.push(profileUrl)
            return Response.json({ name: 'Journal author', avatar_url: imageUrl })
        }),
        http.get(imageUrl, () => {
            requests.push(imageUrl)
            return new Response(new Uint8Array(image))
        })
    )
    const notion = notionClient(await transportClient(), () => token)
    const create = () =>
        new ConnectionProfileCache(
            path,
            () => token,
            () => run(notion.profile()),
            (url) => downloadImage(url, fetch),
            () => time
        )
    return {
        path,
        requests,
        create,
        setToken: (value: string) => (token = value),
        advance: (ms: number) => (time += ms),
        stale: () => (time += 86_400_001)
    }
}

it('persists a bounded thumbnail and reads a warm profile after restart without a network request', async () => {
    const f = await fixture()
    const profile = await f.create().refresh('notion')
    expect(profile?.name).toBe('Journal author')
    expect(profile?.avatarUrl).toMatch(/^data:image\/webp;base64,/)
    const metadata = await sharp(Buffer.from(profile!.avatarUrl!.split(',')[1], 'base64')).metadata()
    expect([metadata.width, metadata.height]).toEqual([64, 64])
    expect(readFileSync(f.path, 'utf8')).not.toContain('private-fixture-token')
    const restarted = f.create()
    expect(await restarted.refresh('notion')).toEqual(profile)
    expect(f.requests).toEqual([profileUrl, imageUrl])
})

it('shares concurrent cold reads and keeps the last profile on a connection failure', async () => {
    const f = await fixture()
    const cache = f.create()
    const [first, second] = await Promise.all([cache.refresh('notion'), cache.refresh('notion')])
    expect(first?.avatarUrl).toMatch(/^data:image\/webp;base64,/)
    expect(second).toEqual(first)
    expect(f.requests).toEqual([profileUrl, imageUrl])
    f.stale()
    server.use(http.get(profileUrl, () => Response.error()))
    expect(await cache.refresh('notion')).toEqual(first)
    expect(f.create().snapshot().notion).toEqual(first)
})

it('hides another account and discards a late profile response after disconnect', async () => {
    const f = await fixture()
    const cache = f.create()
    await cache.refresh('notion')
    f.setToken('different-account')
    expect(cache.snapshot().notion).toBeUndefined()
    const entered = deferred<undefined>()
    const finish = deferred<undefined>()
    server.use(
        http.get(
            profileUrl,
            async () => {
                entered.resolve(undefined)
                await finish.promise
                return Response.json({ name: 'Disconnected account' })
            },
            { once: true }
        )
    )
    const pending = cache.refresh('notion')
    try {
        await entered.promise
        cache.clear('notion')
        finish.resolve(undefined)
        expect(await pending).toBeUndefined()
        expect(f.create().snapshot().notion).toBeUndefined()
        expect((await cache.refresh('notion'))?.name).toBe('Journal author')
    } finally {
        finish.resolve(undefined)
        await pending
    }
})

it('keeps the last image on download failure until the retried profile removes its avatar', async () => {
    const f = await fixture()
    const cache = f.create()
    const old = await cache.refresh('notion')
    f.stale()
    server.use(http.get(imageUrl, () => new Response(null, { status: 404 })))
    expect((await cache.refresh('notion'))?.avatarUrl).toBe(old?.avatarUrl)
    f.advance(300_001)
    server.use(http.get(profileUrl, () => Response.json({ name: 'No avatar' })))
    expect(await cache.refresh('notion')).toEqual({ name: 'No avatar' })
    expect(f.create().snapshot().notion).toEqual({ name: 'No avatar' })
})

it('rebuilds a corrupt profile cache and keeps the name when the image is unavailable', async () => {
    const f = await fixture()
    writeFileSync(f.path, 'broken json')
    server.use(http.get(imageUrl, () => new Response(null, { status: 404 })))
    const cache = f.create()
    expect(cache.snapshot()).toEqual({})
    expect(await cache.refresh('notion')).toEqual({ name: 'Journal author' })
    f.setToken('')
    expect(cache.snapshot()).toEqual({})
})
