import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parsePatch } from '../src/renderer/diff-model'
import type { DiffReply, DiffRequest } from '../src/renderer/diff-loader'

const patch = (name: string) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`
class ParserWorker {
    static instances: ParserWorker[] = []
    messages: DiffRequest[] = []
    onmessage?: (event: { data: DiffReply }) => void
    onerror?: () => void
    terminate = vi.fn()
    constructor() {
        ParserWorker.instances.push(this)
    }
    postMessage(message: DiffRequest) {
        this.messages.push(message)
    }
    reply(reply: DiffReply) {
        this.onmessage?.({ data: reply })
    }
}
beforeEach(() => {
    vi.resetModules()
    ParserWorker.instances = []
    vi.stubGlobal('Worker', ParserWorker)
})
afterEach(() => vi.unstubAllGlobals())

it('makes exact first-file changes readable while remaining files are still parsing and shares the completed preparation', async () => {
    const { subscribeDiff, diffSnapshot, loadDiff } = await import('../src/renderer/diff-loader')
    const text = patch('first.ts') + patch('second.ts')
    const unsubscribe = subscribeDiff(text, vi.fn())
    const ready = loadDiff(text)
    const worker = ParserWorker.instances[0]
    const { id } = worker.messages[0]
    worker.reply({ id, files: parsePatch(patch('first.ts')), total: 2, complete: false })
    expect(diffSnapshot(text)).toMatchObject({ complete: false, total: 2 })
    expect(diffSnapshot(text)?.files.map((file) => file.name)).toEqual(['first.ts'])
    expect(diffSnapshot(text)?.files[0].additionLines).toEqual(['new\n'])
    worker.reply({ id, files: parsePatch(patch('second.ts')), total: 2, complete: true })
    expect((await ready).map((file) => file.name)).toEqual(['first.ts', 'second.ts'])
    const requests = worker.messages.filter((message) => message.text !== undefined).length
    expect((await loadDiff(text)).map((file) => file.name)).toEqual(['first.ts', 'second.ts'])
    expect(worker.messages.filter((message) => message.text !== undefined)).toHaveLength(requests)
    unsubscribe()
})

it('abandons partial changes on worker failure, retains a fallback outcome, and permits a later retry', async () => {
    const { subscribeDiff, diffSnapshot, loadDiff } = await import('../src/renderer/diff-loader')
    const text = patch('first.ts') + patch('second.ts')
    const unsubscribe = subscribeDiff(text, vi.fn())
    const ready = loadDiff(text)
    const worker = ParserWorker.instances[0]
    worker.reply({ id: worker.messages[0].id, files: parsePatch(patch('first.ts')), total: 2, complete: false })
    worker.onerror?.()
    expect(await ready).toEqual([])
    expect(diffSnapshot(text)).toEqual({ files: [], total: 0, complete: true })
    unsubscribe()
    const retried = loadDiff(text)
    const replacement = ParserWorker.instances[1]
    replacement.reply({ id: replacement.messages[0].id, files: parsePatch(text), total: 2, complete: true })
    expect((await retried).map((file) => file.name)).toEqual(['first.ts', 'second.ts'])
})

it('bounds speculative parsing and lets foreground inspection proceed, cancelling abandoned partial work', async () => {
    const { loadDiff, subscribeDiff, diffSnapshot } = await import('../src/renderer/diff-loader')
    const first = loadDiff(patch('one.ts'), 'background')
    const second = loadDiff(patch('two.ts'), 'background')
    expect(await loadDiff(patch('skipped.ts'), 'background')).toEqual([])
    const text = patch('clicked.ts')
    const stop = subscribeDiff(text, vi.fn())
    const clicked = loadDiff(text)
    const worker = ParserWorker.instances[0]
    const request = worker.messages.find((message) => message.text === text)!
    worker.reply({ id: request.id, files: parsePatch(text), total: 1, complete: false })
    expect(diffSnapshot(text)?.files[0].name).toBe('clicked.ts')
    stop()
    expect(await clicked).toEqual([])
    expect(worker.messages.some((message) => message.id === request.id && message.cancel)).toBe(true)
    expect(diffSnapshot(text)).toBeUndefined()
    worker.onerror?.()
    await Promise.all([first, second])
})
