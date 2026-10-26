import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { ApplicationWork } from '../src/main/application-work'

it('observes detached failures while preserving rejection for callers that await the result', async () => {
    const source = new URL('../src/main/application-work.ts', import.meta.url).href
    const script = `
        import { ApplicationWork } from ${JSON.stringify(source)};
        const work = new ApplicationWork();
        void work.run(() => Promise.reject(new Error('detached failure')));
        await new Promise(resolve => setTimeout(resolve, 0));
        const message = await work.run(() => Promise.reject(new Error('awaited failure'))).catch(error => error.message);
        if (message !== 'awaited failure') throw new Error('Caller lost its failure');
        await work.shutdown(() => Promise.resolve());
        console.log('drained');
    `
    const result = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        { timeout: 10000 }
    )
    expect(result.stdout).toContain('drained')
})

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
        void work.run(async () => {
            await Promise.resolve()
            events.push('follow-up')
        })
        events.push('prior')
    })
    await work.run(async (drain) => {
        await drain()
        events.push('restore')
    })
    await prior
    expect(events).toEqual(['prior', 'follow-up', 'restore'])
    await work.shutdown(() => Promise.resolve())
})

it('stops periodic producers after successful shutdown', async () => {
    const work = new ApplicationWork()
    let ticks = 0
    work.repeat(5, () => {
        ticks++
    })
    await vi.waitFor(() => expect(ticks).toBeGreaterThan(0))
    await work.shutdown(() => Promise.resolve())
    const settled = ticks
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(ticks).toBe(settled)
})

it('keeps the runtime usable when durable shutdown fails so saving can be retried', async () => {
    const work = new ApplicationWork()
    await expect(work.shutdown(() => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full')
    expect(await work.run(() => Promise.resolve('retry'))).toBe('retry')
    await work.shutdown(() => Promise.resolve())
})
