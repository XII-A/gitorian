// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceDraft } from '../src/renderer/WorkspaceDraft'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Command, JournalNode } from '../src/shared/model'

const notifications = vi.hoisted(() => ({
    toast: vi.fn<(options: unknown) => string>(() => 'publish'),
    dismiss: vi.fn()
}))
const writer = vi.hoisted(() => ({
    change: undefined as ((body: JournalNode) => void) | undefined,
    template: undefined as JournalNode | undefined
}))
vi.mock('../src/renderer/components/arc/toast-stack/toast-stack', () => ({ useToastStack: () => notifications }))
vi.mock('../src/renderer/Editor', () => ({
    Editor: (props: { onChange: (body: JournalNode) => void; template?: JournalNode }) => {
        writer.change = props.onChange
        writer.template = props.template
        return null
    }
}))

async function update(change: () => unknown) {
    await act(async () => {
        change()
        await Promise.resolve()
    })
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})
afterEach(async () => {
    await update(() => root.unmount())
    container.remove()
    vi.useRealTimers()
})

const body = (text: string): JournalNode => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

it('does no synchronous recovery writes or backend saves during a typing burst, then saves the latest document once', async () => {
    const state = sampleState('2026-10-05')
    const run = vi.fn((_command: Command) =>
        Promise.resolve({ state, connections: { github: false, notion: true, protectedStorage: false } })
    )
    await update(() =>
        root.render(
            createElement(WorkspaceDraft, {
                state,
                week: '2026-10-05',
                sample: false,
                notionConnected: true,
                run,
                publishTarget: null,
                onReady: vi.fn(),
                onSettings: vi.fn()
            })
        )
    )
    await update(() => vi.advanceTimersByTime(1200))
    expect(run).not.toHaveBeenCalled()
    for (let index = 0; index < 20; index++) {
        await update(() => {
            writer.change?.(body(`Writing ${index}`))
            vi.advanceTimersByTime(100)
        })
        expect(localStorage.length).toBe(0)
        expect(run).not.toHaveBeenCalled()
    }
    await update(() => vi.advanceTimersByTime(1000))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatchObject({ type: 'draft', draft: { body: body('Writing 19') } })
})

it('keeps unsaved writing in recovery storage when leaving before the debounce finishes', async () => {
    const state = sampleState('2026-10-05')
    const run = vi.fn(() => Promise.resolve(undefined))
    await update(() =>
        root.render(
            createElement(WorkspaceDraft, {
                state,
                week: '2026-10-05',
                sample: false,
                notionConnected: true,
                run,
                publishTarget: null,
                onReady: vi.fn(),
                onSettings: vi.fn()
            })
        )
    )
    await update(() => writer.change?.(body('Last keystroke')))
    await update(() => window.dispatchEvent(new Event('pagehide')))
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(localStorage.key(0)!)).toContain('Last keystroke')
    expect(run).toHaveBeenCalledTimes(1)
})

it('checkpoints continuous typing and lets an existing empty draft apply the saved template', async () => {
    const state = sampleState('2026-10-05')
    state.drafts[0].body = { type: 'doc', content: [{ type: 'paragraph' }] }
    state.settings.template = body('Weekly template')
    const run = vi.fn(() =>
        Promise.resolve({ state, connections: { github: false, notion: true, protectedStorage: false } })
    )
    await update(() =>
        root.render(
            createElement(WorkspaceDraft, {
                state,
                week: '2026-10-05',
                sample: false,
                notionConnected: true,
                run,
                publishTarget: null,
                onReady: vi.fn(),
                onSettings: vi.fn()
            })
        )
    )
    expect(container.textContent).not.toContain('Use entry template')
    expect(writer.template).toBe(state.settings.template)
    for (let index = 0; index < 11; index++) {
        await update(() => {
            writer.change?.(body(`Uninterrupted ${index}`))
            vi.advanceTimersByTime(500)
        })
    }
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]).toMatchObject([{ type: 'draft', draft: { body: body('Uninterrupted 9') } }])
    expect(state.settings.template).toEqual(body('Weekly template'))
})

it('puts an uncertain publish in an actionable toast, outside the document', async () => {
    const state = sampleState('2026-10-05')
    state.saves = [
        {
            id: 'save-1',
            draftId: state.drafts[0].id,
            status: 'unknown',
            marker: 'test',
            title: 'Week',
            body: body('My writing'),
            selections: [],
            destination: { kind: 'page', id: 'parent', titleProperty: 'Name', dateProperty: '' },
            createdAt: new Date().toISOString()
        }
    ]
    const run = vi.fn(() => Promise.resolve(undefined))
    await update(() =>
        root.render(
            createElement(WorkspaceDraft, {
                state,
                week: '2026-10-05',
                sample: false,
                notionConnected: true,
                run,
                publishTarget: null,
                onReady: vi.fn(),
                onSettings: vi.fn()
            })
        )
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const toast = notifications.toast.mock.calls.at(-1)?.[0] as {
        action: { label: string; onClick: () => void }
    }
    expect(toast).toMatchObject({ title: 'Verify the Notion save', action: { label: 'Verify save' } })
    toast.action.onClick()
    expect(run).toHaveBeenCalledWith({ type: 'reconcile', saveId: 'save-1' })
})
