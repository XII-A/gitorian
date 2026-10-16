// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { expect, it, vi } from 'vitest'
import { Editor } from '../src/renderer/Editor'
import type { JournalNode } from '../src/shared/model'

it('offers icon-and-label commands, scrolls the active keyboard option, and inserts a template without replacing writing', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const value: JournalNode = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep my writing' }] }, { type: 'paragraph' }]
    }
    const template: JournalNode = {
        type: 'doc',
        content: [
            { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Template heading' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Template body' }] }
        ]
    }
    const onChange = vi.fn()
    try {
        await act(async () => {
            root.render(createElement(Editor, { value, template, onChange }))
            await Promise.resolve()
        })
        const element = host.querySelector('.tiptap') as HTMLElement & { editor: TiptapEditor }
        const writing = element.editor
        await act(async () => {
            writing.commands.setTextSelection(writing.state.doc.content.size - 1)
            writing.commands.insertContent('/')
            await Promise.resolve()
        })
        const options = [...document.querySelectorAll<HTMLElement>('.ws-block-menu [role="option"]')]
        expect(host.contains(document.querySelector('.ws-block-menu'))).toBe(false)
        expect(options).toHaveLength(12)
        expect(options.every((option) => !!option.querySelector('svg') && !option.querySelector('small'))).toBe(true)
        const viewport = document.querySelector<HTMLElement>('[aria-label="Formatting options"]')!
        vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 250, 100))
        options.forEach((option, index) =>
            vi
                .spyOn(option, 'getBoundingClientRect')
                .mockImplementation(() => new DOMRect(0, index * 44 - viewport.scrollTop, 250, 44))
        )
        for (let index = 0; index < 11; index++)
            await act(async () => {
                element.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
                )
                await Promise.resolve()
            })
        expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true')
        expect(viewport.scrollTop).toBeGreaterThan(0)
        expect(options.at(-1)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(100)
        await act(async () => {
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
            await Promise.resolve()
        })
        expect(writing.getText()).toContain('Keep my writing')
        expect(writing.getText()).toContain('Template heading')
        expect(writing.getJSON().content?.some((node) => node.type === 'heading' && node.attrs?.level === 4)).toBe(true)
        expect(document.querySelector('.ws-block-menu[role="listbox"]')).toBeNull()
        writing.commands.undo()
        expect(writing.getText()).not.toContain('Template heading')
        expect(template.content?.[0].content?.[0].text).toBe('Template heading')
        await act(async () => {
            writing.commands.setContent('<p>/unmatched-format</p>')
            writing.commands.setTextSelection(writing.state.doc.content.size - 1)
            await Promise.resolve()
        })
        const empty = document.querySelector('.ws-block-menu .ws-block-empty')
        expect(empty?.textContent).toBe('No matching formats')
        expect(document.querySelectorAll('.ws-block-menu [role="option"]')).toHaveLength(0)
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        host.remove()
        vi.restoreAllMocks()
    }
})
