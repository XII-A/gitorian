import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Command, Draft, JournalNode, Reply } from '../src/shared/model'
import { WritingSession } from '../src/renderer/writing-session'
import { sampleState } from './workspace-fixture'

const week = '2026-10-05'
const body = (text: string): JournalNode => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})
const snapshot = (text: string) => ({ read: vi.fn(() => body(text)), wordCount: () => 2 })
function gate<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<T>((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
function fixture(storage = new Map<string, string>()) {
    const state = sampleState(week)
    state.drafts[0].version = 1
    let restoreId = state.restoreId
    const reply = (draft?: Draft): Reply => ({
        state,
        connections: { remote: false, notion: true, protectedStorage: false },
        ...(draft ? { draftSaved: { id: draft.id, version: draft.version + 1 } } : {})
    })
    const run = vi.fn<(command: Command) => Promise<Reply | undefined>>((command) =>
        Promise.resolve(reply(command.type === 'draft' ? command.draft : undefined))
    )
    const recovery = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: vi.fn((key: string, value: string) => {
            storage.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
            storage.delete(key)
        })
    }
    const session = new WritingSession({ week, restoreId, run, recovery, currentRestoreId: () => restoreId })
    session.attach()
    session.observe(state)
    return {
        state,
        session,
        run,
        reply,
        recovery,
        storage,
        restore: () => {
            restoreId = 'restored'
        }
    }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('keeps typing lazy and checkpoints the latest revision after idle or continuous writing', async () => {
    const { session, run, recovery } = fixture()
    const rendered = vi.fn()
    session.subscribe(rendered)
    const revisions = Array.from({ length: 20 }, (_, i) => snapshot(`Writing ${i}`))
    for (const revision of revisions) {
        session.edit({ body: revision })
        await vi.advanceTimersByTimeAsync(100)
    }
    expect(revisions.every((revision) => revision.read.mock.calls.length === 0)).toBe(true)
    expect(recovery.setItem).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(rendered.mock.calls.length).toBeLessThanOrEqual(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatchObject({ type: 'draft', draft: { body: body('Writing 19') } })
    for (let i = 0; i < 11; i++) {
        session.edit({ body: snapshot(`Continuous ${i}`) })
        await vi.advanceTimersByTimeAsync(500)
    }
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0]).toMatchObject({ type: 'draft', draft: { body: body('Continuous 9') } })
})

it('saves edits whose debounce expires during an earlier write, without overlapping requests', async () => {
    const { session, run, reply } = fixture()
    const pending = gate<Reply>()
    run.mockImplementationOnce(() => pending.promise)
    session.edit({ body: snapshot('First') })
    await vi.advanceTimersByTimeAsync(1000)
    session.edit({ body: snapshot('Typed while saving') })
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    const command = run.mock.calls[0][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    pending.resolve(reply(command.draft))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0]).toMatchObject({
        type: 'draft',
        draft: { version: 2, body: body('Typed while saving') }
    })
    expect(session.getSnapshot().status).toBe('saved')
})

it('releases failed update preparation and fences an in-flight write after restore', async () => {
    const { session, run, restore, storage, reply } = fixture()
    session.edit({ body: snapshot('Retained writing') })
    run.mockRejectedValueOnce(new Error('Disconnected'))
    await expect(session.prepareUpdate()).rejects.toThrow('Retry saving')
    expect(session.getSnapshot().busy).toBe(false)
    const pending = gate<Reply>()
    run.mockImplementationOnce(() => pending.promise)
    const publication = session.publish()
    const command = run.mock.calls[1][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    restore()
    pending.resolve(reply(command.draft))
    expect(await publication).toBe('retired')
    expect(run).toHaveBeenCalledTimes(2)
    expect([...storage.values()][0]).toContain('Retained writing')
})

it('advances only its own acknowledgment without mutating a submitted draft or replacing newer edits', async () => {
    const { state, session, run, reply } = fixture()
    const pending = gate<Reply>()
    run.mockImplementationOnce(() => pending.promise)
    const originalBody = session.getSnapshot().draft!.body
    session.edit({ body: snapshot('First edit') })
    const saved = session.retrySave()
    const command = run.mock.calls[0][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    const sent = structuredClone(command)
    session.edit({ body: snapshot('Continued local writing') })
    session.edit({ title: 'New title' })
    pending.resolve({
        ...reply(command.draft),
        state: { ...state, drafts: [{ ...state.drafts[0], version: 3, body: body('Other writer') }] }
    })
    await saved
    expect(command).toEqual(sent)
    expect(session.getSnapshot().draft!.body).toBe(originalBody)
    await session.retrySave()
    expect(run.mock.calls[1][0]).toMatchObject({
        type: 'draft',
        draft: { version: 2, title: 'New title', body: body('Continued local writing') }
    })
})

it('captures recovery synchronously on leaving and an old completion cannot clear a reopened session', async () => {
    const first = fixture()
    const pending = gate<Reply>()
    first.run.mockImplementationOnce(() => pending.promise)
    first.session.edit({ body: snapshot('Last keystroke') })
    first.session.detach()
    expect([...first.storage.values()][0]).toContain('Last keystroke')
    const next = fixture(first.storage)
    next.session.edit({ body: snapshot('Newer session') })
    next.run.mockResolvedValue(undefined)
    next.session.checkpoint()
    const command = first.run.mock.calls[0][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    pending.resolve(first.reply(command.draft))
    await Promise.resolve()
    await Promise.resolve()
    expect([...first.storage.values()][0]).toContain('Newer session')
    expect(next.session.getSnapshot().status).not.toBe('saved')
})

it('does not dispatch a write on teardown after restore or publish after a retired save', async () => {
    const restored = fixture()
    restored.session.edit({ body: snapshot('Before restore') })
    restored.restore()
    restored.session.detach()
    expect(restored.run).not.toHaveBeenCalled()
    expect([...restored.storage.values()][0]).toContain('Before restore')

    const leaving = fixture()
    const pending = gate<Reply>()
    leaving.run.mockImplementationOnce(() => pending.promise)
    leaving.session.edit({ body: snapshot('Before publishing') })
    const published = leaving.session.publish()
    leaving.session.detach()
    const command = leaving.run.mock.calls[0][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    pending.resolve(leaving.reply(command.draft))
    expect(await published).toBe('retired')
    expect(leaving.run).toHaveBeenCalledTimes(1)
})

it('releases a rejected save so explicit retry can persist the retained writing', async () => {
    const { session, run, storage } = fixture()
    run.mockRejectedValueOnce(new Error('Connection closed'))
    session.edit({ body: snapshot('Keep this') })
    expect(await session.retrySave()).toBe('failed')
    expect([...storage.values()][0]).toContain('Keep this')
    expect(await session.retrySave()).toBe('saved')
    expect(storage.size).toBe(0)
    expect(run).toHaveBeenCalledTimes(2)
})

it('uses one exclusive preparation for publishing and updates, with an idempotent resume', async () => {
    const { session, run, reply } = fixture()
    const pending = gate<Reply>()
    run.mockImplementationOnce(() => pending.promise)
    session.edit({ body: snapshot('Saved before updating') })
    const preparing = session.prepareUpdate()
    expect(session.getSnapshot().busy).toBe(true)
    expect(await session.publish()).toBe('blocked')
    const command = run.mock.calls[0][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    pending.resolve(reply(command.draft))
    const resume = await preparing
    expect(session.getSnapshot().busy).toBe(true)
    resume()
    const again = await session.prepareUpdate()
    resume()
    expect(session.getSnapshot().busy).toBe(true)
    again()
    expect(session.getSnapshot().busy).toBe(false)
})

it('blocks pending images and recovers from storage failure without claiming durable loss', async () => {
    const { session, run, recovery } = fixture()
    session.setImagesReady(false)
    await expect(session.prepareUpdate()).rejects.toThrow('image imports')
    expect(await session.publish()).toBe('blocked')
    expect(run).not.toHaveBeenCalled()
    session.setImagesReady(true)
    session.edit({ body: snapshot('Still saved to the database') })
    recovery.setItem.mockImplementation(() => {
        throw new Error('Quota')
    })
    expect(await session.retrySave()).toBe('saved')
    expect(session.getSnapshot().saveIssue).toBeUndefined()
})

it('keeps both conflict copies if recovery cleanup fails, then confirms an explicit retry', async () => {
    const state = sampleState(week)
    const copy = { ...state.drafts[0], version: 2, title: 'Unsaved recovery' }
    const storage = new Map([[`gitorian:recovery:local:${week}`, JSON.stringify(copy)]])
    const { session, recovery } = fixture(storage)
    expect(session.getSnapshot().conflict?.recovery.title).toBe('Unsaved recovery')
    recovery.removeItem.mockImplementationOnce(() => {
        throw new Error('Storage unavailable')
    })
    await session.resolveConflict('saved')
    expect(session.getSnapshot().conflict?.recovery.title).toBe('Unsaved recovery')
    expect(session.getSnapshot().conflictError).toContain('Both copies are still available')
    expect(storage.size).toBe(1)
    await session.resolveConflict('saved')
    expect(session.getSnapshot().conflict).toBeUndefined()
    expect(session.getSnapshot().draft?.title).toBe(state.drafts[0].title)
    expect(storage.size).toBe(0)
})

it('reattaches without duplicating accepted creation or leaving writing permanently retired', async () => {
    const { session, state, run, reply } = fixture()
    const empty = { ...state, drafts: [] }
    const fresh = new WritingSession({
        week,
        restoreId: state.restoreId,
        currentRestoreId: () => state.restoreId,
        run,
        recovery: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }
    })
    const pending = gate<Reply>()
    run.mockImplementationOnce(() => pending.promise)
    fresh.attach()
    fresh.observe(empty)
    const started = fresh.start()
    fresh.detach()
    fresh.attach()
    fresh.observe(empty)
    expect(await fresh.start()).toBe('busy')
    pending.resolve(reply())
    expect(await started).toBe('created')
    expect(run).toHaveBeenCalledTimes(1)
    fresh.edit({ title: 'After replay' })
    expect(await fresh.retrySave()).toBe('saved')
    expect(fresh.getSnapshot().draft?.title).toBe('After replay')
    session.detach()
})

it('resumes newer writing after reattachment while the earlier revision is still saving', async () => {
    const { session, run, state, reply, storage } = fixture()
    const pending = gate<Reply>()
    run.mockImplementationOnce(() => pending.promise)
    session.edit({ title: 'A' })
    const saving = session.retrySave()
    session.edit({ title: 'B' })
    session.detach()
    session.attach()
    session.observe(state)
    expect(run).toHaveBeenCalledTimes(1)
    const command = run.mock.calls[0][0]
    if (command.type !== 'draft') throw new Error('Expected draft write')
    pending.resolve(reply(command.draft))
    await saving
    await vi.advanceTimersByTimeAsync(1300)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0]).toMatchObject({ type: 'draft', draft: { title: 'B', version: 2 } })
    expect(session.getSnapshot().status).toBe('saved')
    expect(storage.size).toBe(0)
})
