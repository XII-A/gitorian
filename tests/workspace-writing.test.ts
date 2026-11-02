// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceDraft } from '../src/renderer/WorkspaceDraft'
import { writingFixture } from './writing-fixture'
import { sampleState } from './workspace-fixture'
import type { JournalNode } from '../src/shared/model'
import type { EditorSnapshot } from '../src/renderer/editor-snapshot'

const notifications = vi.hoisted(() => ({
    toast: vi.fn<(options: unknown) => string>(() => 'publish'),
    dismiss: vi.fn(),
    update: vi.fn()
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
        await new Promise((resolve) => setTimeout(resolve, 50))
    })
}

let fixture: Awaited<ReturnType<typeof writingFixture>> | undefined
let root: Root
let container: HTMLDivElement
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

    vi.clearAllMocks()
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})
afterEach(async () => {
    await update(() => root.unmount())
    await fixture?.close()
    fixture = undefined
    container.remove()
    vi.useRealTimers()
})

const body = (text: string): JournalNode => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

it.each([true, false])(
    'keeps uncertain publication recovery actionable (Notion connected: %s)',
    async (notionConnected) => {
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
        fixture = await writingFixture(state)
        state.saves[0].draftId = state.drafts[0].id
        const run = vi.fn(() => Promise.resolve(undefined))
        await update(() =>
            root.render(
                createElement(WorkspaceDraft, {
                    state,
                    week: '2026-10-05',
                    notionConnected,
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
    }
)

it('reopens published weekly writing as editable with a publish action', async () => {
    const state = sampleState('2026-10-05')
    state.settings.destination = { kind: 'page', id: 'parent', titleProperty: 'Name', dateProperty: '' }
    state.drafts[0].publishedEntryId = 'published-page'
    fixture = await writingFixture(state)
    state.drafts[0].publishedEntryId = 'published-page'
    const run = vi.fn(() => Promise.resolve(undefined))
    await update(() =>
        root.render(
            createElement(WorkspaceDraft, {
                state,
                week: '2026-10-05',
                notionConnected: true,
                run,
                publishTarget: container,
                onReady: vi.fn(),
                onSettings: vi.fn()
            })
        )
    )
    for (let i = 0; i < 10 && !container.querySelector('[aria-label="Entry title"]'); i++) await update(() => undefined)
    const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Entry title"]')
    expect(title?.textContent).toBe(state.drafts[0].title)
    expect(title?.getAttribute('contenteditable')).toBe('true')
    expect(container.textContent).toContain('Update in Notion')
})

it.each([false, true])(
    'confirms a successful Notion write with a toast and update action (already published: %s)',
    async (published) => {
        const state = sampleState('2026-10-05')
        state.settings.destination = { kind: 'page', id: 'parent', titleProperty: 'Name', dateProperty: '' }
        fixture = await writingFixture(state)
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
                    notionConnected: true,
                    run,
                    publishTarget: container,
                    onReady: vi.fn(),
                    onSettings: vi.fn()
                })
            )
        )
        for (let i = 0; i < 10 && container.querySelector<HTMLButtonElement>('button')!.disabled; i++)
            await update(() => undefined)
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
