import { expect, it } from 'vitest'
import { ApplicationWork } from '../src/main/application-work'

it('drains accepted work and its follow-up work even when another task fails', async () => {
    const work = new ApplicationWork()
    const events: string[] = []
    let release!: () => void
    const pending = work.run(async () => {
        await new Promise<void>((resolve) => {
            release = resolve
        })
        void work.run(async () => {
            await Promise.resolve()
            events.push('follow-up')
        })
        events.push('first')
    })
    const failed = work.run(() => Promise.reject(new Error('source failed'))).catch(() => events.push('failed'))
    const closing = work.shutdown(() => {
        events.push('saved')
        return Promise.resolve()
    })
    release()
    await Promise.all([pending, failed, closing])
    expect(events).toContain('follow-up')
    expect(events.at(-1)).toBe('saved')
    await expect(work.run(() => Promise.resolve())).rejects.toThrow('closed')
})

it('lets a restore command drain prior work without waiting for itself', async () => {
    const work = new ApplicationWork()
    const events: string[] = []
    const prior = work.run(async () => {
        await Promise.resolve()
        events.push('prior')
    })
    await work.run(async (drain) => {
        await drain()
        events.push('restore')
    })
    await prior
    expect(events).toEqual(['prior', 'restore'])
    await work.shutdown(() => Promise.resolve())
})

it('keeps the runtime usable when durable shutdown fails so saving can be retried', async () => {
    const work = new ApplicationWork()
    await expect(work.shutdown(() => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full')
    expect(await work.run(() => Promise.resolve('retry'))).toBe('retry')
    await work.shutdown(() => Promise.resolve())
})
