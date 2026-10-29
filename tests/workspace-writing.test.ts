// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceDraft } from '../src/renderer/WorkspaceDraft'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Command, JournalNode, Reply } from '../src/shared/model'
import type { EditorSnapshot } from '../src/renderer/editor-snapshot'

const notifications = vi.hoisted(() => ({
    toast: vi.fn<(options: unknown) => string>(() => 'publish'),
    dismiss: vi.fn()
}))
const writer = vi.hoisted(() => ({
    change: undefined as ((body: JournalNode) => void) | undefined,
    template: undefined as JournalNode | undefined,
    edit: undefined as ((snapshot: EditorSnapshot) => void) | undefined
}))
vi.mock('../src/renderer/components/arc/toast-stack/toast-stack', () => ({ useToastStack: () => notifications }))
vi.mock('../src/renderer/components/arc/button/button', () => ({
    Button: ({
        children,
        onClick,
        disabled,
        loading
    }: {
        children: React.ReactNode
        onClick: () => void
        disabled?: boolean
        loading?: boolean
    }) => createElement('button', { onClick, disabled: disabled || loading }, children)
}))
vi.mock('../src/renderer/Editor', () => ({
    Editor: (props: { onEdit: (snapshot: EditorSnapshot) => void; template?: JournalNode }) => {
        writer.edit = props.onEdit
        writer.change = (body) => props.onEdit({ read: () => body, wordCount: () => 2 })
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
        Promise.resolve({ state, connections: { remote: false, notion: true, protectedStorage: false } })
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
        Promise.resolve({ state, connections: { remote: false, notion: true, protectedStorage: false } })
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

it('reopens published weekly writing as editable with a publish action', async () => {
    const state = sampleState('2026-10-05')
    state.drafts[0].publishedEntryId = 'published-page'
    const run = vi.fn(() => Promise.resolve(undefined))
    await update(() =>
        root.render(
            createElement(WorkspaceDraft, {
                state,
                week: '2026-10-05',
                sample: false,
                notionConnected: true,
                run,
                publishTarget: container,
                onReady: vi.fn(),
                onSettings: vi.fn()
            })
        )
    )
    const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Entry title"]')
    expect(title?.value).toBe(state.drafts[0].title)
    expect(title?.readOnly).toBe(false)
    expect(container.textContent).toContain('Update in Notion')
    await update(() => writer.change?.(body('Edited published week')))
    await update(() => vi.advanceTimersByTime(1000))
    expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
            type: 'draft',
            draft: expect.objectContaining({ body: body('Edited published week') })
        })
    )
})

it.each([false, true])(
    'confirms a successful Notion write with a toast and update action (already published: %s)',
    async (published) => {
        const state = sampleState('2026-10-05')
        state.settings.destination = { kind: 'page', id: 'parent', titleProperty: 'Name', dateProperty: '' }
        state.drafts[0].publishedEntryId = published ? 'published-page' : undefined
        const saved = structuredClone(state)
        saved.drafts[0].publishedEntryId = 'published-page'
        saved.saves = [
            {
                id: 'confirmed-save',
                draftId: state.drafts[0].id,
                status: 'confirmed',
                marker: 'fixture',
                title: state.drafts[0].title,
                body: state.drafts[0].body,
                selections: [],
                destination: state.settings.destination,
                createdAt: new Date().toISOString()
            }
        ]
        const run = vi.fn(() =>
            Promise.resolve({ state: saved, connections: { remote: false, notion: true, protectedStorage: false } })
        )
        await update(() =>
            root.render(
                createElement(WorkspaceDraft, {
                    state,
                    week: '2026-10-05',
                    sample: false,
                    notionConnected: true,
                    run,
                    publishTarget: container,
                    onReady: vi.fn(),
                    onSettings: vi.fn()
                })
            )
        )
        await update(() => container.querySelector<HTMLButtonElement>('button')!.click())
        expect(run).toHaveBeenCalledWith({ type: 'publish', draftId: state.drafts[0].id })
        expect(notifications.toast).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'success',
                title: published ? 'Updated in Notion' : 'Published to Notion'
            })
        )
        expect(container.textContent).toContain('Update in Notion')
    }
)

it('advances dirty writing only to its own save acknowledgment when another writer changes the snapshot', async () => {
    const state = sampleState('2026-10-05')
    state.drafts[0].version = 1
    let release!: (value: Reply) => void
    const run = vi.fn(
        (_command: Command) =>
            new Promise<Reply>((resolve) => {
                release = resolve
            })
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
    await update(() => writer.change?.(body('First edit')))
    await update(() => vi.advanceTimersByTime(1000))
    await update(() => writer.change?.(body('Continued local writing')))
    await update(() =>
        release({
            state: { ...state, drafts: [{ ...state.drafts[0], version: 3, body: body('Another writer') }] },
            draftSaved: { id: state.drafts[0].id, version: 2 },
            connections: { remote: false, notion: true, protectedStorage: false }
        })
    )
    await update(() => vi.advanceTimersByTime(1000))
    expect(run.mock.calls[1][0]).toMatchObject({
        type: 'draft',
        draft: { version: 2, body: body('Continued local writing') }
    })
    await update(() =>
        release({
            state,
            draftSaved: { id: state.drafts[0].id, version: 3 },
            connections: { remote: false, notion: true, protectedStorage: false }
        })
    )
})
