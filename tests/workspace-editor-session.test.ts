// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { expect, it, vi } from 'vitest'
import { WorkspaceDraft } from '../src/renderer/WorkspaceDraft'
import { sampleState } from './workspace-fixture'
import type { Command, Reply } from '../src/shared/model'

const notifications = vi.hoisted(() => ({ toast: vi.fn(), dismiss: vi.fn(), update: vi.fn() }))
vi.mock('../src/renderer/components/arc/toast-stack/toast-stack', () => ({
    useToastStack: () => notifications
}))

it('keeps actual editor revisions through idle saves, title edits, citations, in-flight writes and pagehide', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const state = sampleState('2026-10-05')
    state.drafts[0].body = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original' }] }]
    }
    let finish: ((reply: Reply) => void) | undefined
    const saved: Command[] = []
    const run = vi.fn((command: Command) => {
        saved.push(structuredClone(command))
        return new Promise<Reply>((resolve) => {
            finish = (reply) =>
                resolve({
                    ...reply,
                    ...(command.type === 'draft'
                        ? { draftSaved: { id: command.draft.id, version: command.draft.version + 1 } }
                        : {})
                })
        })
    })
    const props = {
        state,
        week: '2026-10-05',
        notionConnected: true,
        run,
        publishTarget: null,
        onReady: vi.fn(),
        onSettings: vi.fn()
    }
    const update = async (action: () => void) => {
        await act(async () => {
            action()
            await Promise.resolve()
        })
    }
    try {
        await update(() => root.render(createElement(WorkspaceDraft, props)))
        const writing = (host.querySelector('.tiptap') as HTMLElement & { editor: TiptapEditor }).editor
        await update(() => {
            writing.commands.setTextSelection(writing.state.doc.content.size - 1)
            writing.commands.insertContent(' first')
        })
        const serialize = vi.spyOn(writing.state.doc, 'toJSON')
        await update(() => vi.advanceTimersByTime(250))
        expect(serialize).not.toHaveBeenCalled()
        expect(run).not.toHaveBeenCalled()
        await update(() => vi.advanceTimersByTime(750))
        expect(serialize).toHaveBeenCalledTimes(1)
        expect(saved[0]).toMatchObject({ type: 'draft', draft: { body: writing.getJSON() } })
        await update(() => {
            finish?.({ state, connections: { remote: false, notion: true, protectedStorage: false } })
        })
        await update(() => writing.commands.insertContent(' second'))
        // A title change must read the current editor revision rather than feed an older saved body back into it.
        const title = host.querySelector('textarea')!
        await update(() => {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(title, 'New title')
            title.dispatchEvent(new Event('input', { bubbles: true }))
        })
        expect(writing.getText()).toContain('Original first second')
        await update(() =>
            root.render(
                createElement(WorkspaceDraft, {
                    ...props,
                    citation: { id: 1, title: 'My citation', url: 'https://example.com/work' }
                })
            )
        )
        expect(writing.getText()).toContain('Original first second')
        expect(writing.getText()).toContain('My citation')
        await update(() => writing.commands.undo())
        expect(writing.getText()).not.toContain('My citation')
        expect(writing.getText()).toContain('Original first second')
        await update(() => vi.advanceTimersByTime(1000))
        expect(saved[1]).toMatchObject({ type: 'draft', draft: { title: 'New title', body: writing.getJSON() } })
        await update(() => writing.commands.insertContent(' last'))
        await update(() => {
            finish?.({ state, connections: { remote: false, notion: true, protectedStorage: false } })
        })
        expect(host.querySelector('[role="status"]')?.textContent).toContain('Saving')
        await update(() => window.dispatchEvent(new Event('pagehide')))
        expect(saved[2]).toMatchObject({ type: 'draft', draft: { body: writing.getJSON() } })
        expect(localStorage.getItem(localStorage.key(0)!)).toContain('last')
        await update(() => {
            finish?.({ state, connections: { remote: false, notion: true, protectedStorage: false } })
        })
    } finally {
        await update(() => root.unmount())
        localStorage.clear()
        vi.useRealTimers()
        host.remove()
    }
})
