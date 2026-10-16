// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { App } from '../src/renderer/App'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Command, Reply, State } from '../src/shared/model'
import { ReplyUpdates } from '../src/shared/state-updates'
import { shareSnapshot } from '../src/shared/snapshot'

const workspace = vi.hoisted(() => ({
    states: [] as State[],
    run: undefined as ((command: Command) => Promise<Reply | undefined>) | undefined
}))
vi.mock('../src/renderer/Workspace', () => ({
    Workspace: (props: { state: State; run: typeof workspace.run }) => {
        workspace.states.push(props.state)
        workspace.run = props.run
        return null
    }
}))
vi.mock('../src/renderer/AcquisitionStatus', () => ({ AcquisitionStatus: () => null }))
vi.mock('../src/renderer/BackgroundNotifications', () => ({ BackgroundNotifications: () => null }))

it('keeps unchanged activity and settings references across draft saves and updates only changed background records', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    window.history.replaceState({}, '', '/?workspace=true&week=2026-10-05')
    const state = sampleState('2026-10-05')
    state.snapshotVersion = 1
    window.journal = {
        invoke: vi.fn((command: Command) => {
            if (command.type === 'draft') {
                state.drafts[0] = command.draft
                state.snapshotVersion = (state.snapshotVersion ?? 0) + 1
            }
            return Promise.resolve(
                structuredClone({ state, connections: { github: false, notion: false, protectedStorage: false } })
            )
        })
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => {
            root.render(createElement(App))
            await Promise.resolve()
        })
        const before = workspace.states.at(-1)!
        await act(async () => {
            await workspace.run?.({ type: 'draft', draft: { ...state.drafts[0], title: 'Changed title' } })
        })
        const saved = workspace.states.at(-1)!
        expect(saved.activities).toBe(before.activities)
        expect(saved.repositories).toBe(before.repositories)
        expect(saved.settings).toBe(before.settings)
        expect(saved.drafts[0].title).toBe('Changed title')
        state.activities[0].title = 'Updated activity'
        state.snapshotVersion = (state.snapshotVersion ?? 0) + 1
        await act(async () => {
            await workspace.run?.({ type: 'state' })
        })
        const refreshed = workspace.states.at(-1)!
        expect(refreshed.activities[0].title).toBe('Updated activity')
        expect(refreshed.activities[1]).toBe(saved.activities[1])
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        host.remove()
        window.history.replaceState({}, '', '/')
    }
})

it('uses incremental desktop replies while preserving the captured baseline through a real mounted App', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    workspace.states.length = 0
    window.history.replaceState({}, '', '/?workspace=true&week=2026-10-05')
    const state = sampleState('2026-10-05')
    state.snapshotVersion = 1
    const server = new ReplyUpdates()
    let snapshot: State | undefined
    const invoke = vi.fn()
    const updates: NonNullable<typeof window.journal.updates> = vi.fn((command, base) => {
        if (command.type === 'draft') {
            state.drafts[0] = command.draft
            state.snapshotVersion!++
        }
        snapshot = shareSnapshot(snapshot, state)
        return Promise.resolve(
            structuredClone(
                server.pack(
                    { state: snapshot, connections: { github: false, notion: false, protectedStorage: false } },
                    base
                )
            )
        )
    })
    window.journal = { invoke, updates }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await act(async () => {
            root.render(createElement(App))
            await Promise.resolve()
        })
        const before = workspace.states.at(-1)!
        await act(async () => {
            await workspace.run?.({ type: 'draft', draft: { ...state.drafts[0], title: 'Incremental save' } })
        })
        expect(workspace.states.at(-1)!.drafts[0].title).toBe('Incremental save')
        expect(workspace.states.at(-1)!.activities).toBe(before.activities)
        expect(invoke).not.toHaveBeenCalled()
        state.activities[0].title = 'Acquired'
        state.snapshotVersion++
        await act(async () => {
            await workspace.run?.({ type: 'state' })
        })
        expect(workspace.states.at(-1)!.activities[0].title).toBe('Acquired')
        expect(workspace.states.at(-1)!.activities[1]).toBe(before.activities[1])
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        host.remove()
        window.history.replaceState({}, '', '/')
    }
})
