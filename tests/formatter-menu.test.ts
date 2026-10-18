// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { expect, it, vi } from 'vitest'
import { Editor } from '../src/renderer/Editor'
import type { JournalNode } from '../src/shared/model'

async function settle(update: () => unknown) {
    await act(async () => {
        update()
        await Promise.resolve()
    })
}

async function withFormatter(run: (writing: TiptapEditor, element: HTMLElement) => Promise<void>) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await settle(() => {
            root.render(createElement(Editor, { value: { type: 'doc', content: [{ type: 'paragraph' }] } }))
        })
        const element = host.querySelector('.tiptap') as HTMLElement & { editor: TiptapEditor }
        await run(element.editor, element)
    } finally {
        await settle(() => root.unmount())
        host.remove()
    }
}

async function chooseFormat(writing: TiptapEditor, element: HTMLElement, command: string, position: number) {
    await settle(() => {
        writing.commands.setTextSelection(position)
        writing.commands.insertContent(`/${command}`)
    })
    expect(document.querySelectorAll('.ws-block-menu [role="option"]')).toHaveLength(1)
    await settle(() => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('.ws-block-menu')).toBeNull()
}

it.each([
    ['Heading 1', 'heading'],
    ['Toggle', 'toggle'],
    ['Bullet list', 'bulletList'],
    ['Numbered list', 'orderedList'],
    ['Checklist', 'taskList'],
    ['Quote', 'blockquote'],
    ['Code block', 'codeBlock']
])('creates %s consistently below existing writing', async (command, type) => {
    await withFormatter(async (writing, element) => {
        await settle(() => writing.commands.setContent('<p>Before after</p><p>Next block</p>'))
        await chooseFormat(writing, element, command, 8)
        expect(writing.getJSON().content?.map((node) => node.type)).toEqual(['paragraph', type, 'paragraph'])
        expect(writing.getJSON().content?.[0].content).toEqual([{ type: 'text', text: 'Before after' }])
        expect(writing.getJSON().content?.[2].content).toEqual([{ type: 'text', text: 'Next block' }])
        expect(writing.state.selection.$from.parent.textContent).toBe('')
    })
})

it.each(['Heading 1', 'Toggle', 'Bullet list', 'Numbered list', 'Checklist', 'Quote', 'Code block'])(
    'turns existing writing into %s without losing text on either side of the cursor',
    async (command) => {
        await withFormatter(async (writing, element) => {
            await settle(() => writing.commands.setContent('<p><strong>Before </strong>after</p>'))
            await chooseFormat(writing, element, `turn ${command}`, 8)
            expect(writing.state.doc.textContent).toBe('Before after')
            // StarterKit appends an editable trailing paragraph after non-paragraph blocks.
            expect(
                writing.getJSON().content?.filter((node) => node.type !== 'paragraph' || node.content?.length)
            ).toHaveLength(1)
            expect(writing.state.selection.$from.parent.textContent).toBe('Before after')
            expect(writing.state.selection.$from.parentOffset).toBe(7)
            if (command !== 'Code block')
                expect(writing.state.selection.$from.parent.firstChild?.marks[0]?.type.name).toBe('bold')
        })
    }
)

it.each(['Text', 'h1', 'h2', 'h3', 'h4', 'Toggle', 'Bullet list', 'Numbered list', 'todo', 'Quote', 'Code block'])(
    'reuses an empty block for %s and supports undo and redo',
    async (command) => {
        await withFormatter(async (writing, element) => {
            await chooseFormat(writing, element, command, 1)
            expect(writing.state.doc.textContent).toBe('')
            const formatted = writing.getJSON()
            expect(formatted.content?.filter((node) => node.type !== 'paragraph')).toHaveLength(
                command === 'Text' ? 0 : 1
            )
            await settle(() => {
                writing.commands.undo()
            })
            expect(writing.getJSON().content?.[0].type).toBe('paragraph')
            await settle(() => {
                writing.commands.redo()
            })
            expect(writing.getJSON()).toEqual(formatted)
        })
    }
)

it.each([1, 8, 13])('creates and converts consistently at text position %s', async (position) => {
    await withFormatter(async (writing, element) => {
        await settle(() => writing.commands.setContent('<p>Before after</p>'))
        await chooseFormat(writing, element, 'h1', position)
        expect(writing.getJSON().content?.[0]).toEqual({
            type: 'paragraph',
            content: [{ type: 'text', text: 'Before after' }]
        })
        await settle(() => writing.commands.setContent('<p>Before after</p>'))
        await chooseFormat(writing, element, 'turnh1', position)
        expect(writing.getJSON().content?.[0]).toEqual({
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Before after' }]
        })
        expect(writing.state.selection.$from.parentOffset).toBe(position - 1)
    })
})

it('converts a toggle summary in place while preserving its children', async () => {
    await withFormatter(async (writing, element) => {
        await settle(() =>
            writing.commands.setContent(
                '<div data-type="toggle"><div data-type="toggleSummary">Summary</div><div data-type="toggleContent"><p>Keep child</p><h2>Nested heading</h2></div></div>'
            )
        )
        await chooseFormat(writing, element, 'turn into h1', 2)
        const nodes = writing.getJSON().content
        expect(nodes.slice(0, 3).map((node) => node.type)).toEqual(['heading', 'paragraph', 'heading'])
        expect(writing.state.doc.textContent).toBe('SummaryKeep childNested heading')
    })
})

it('converts one list item and preserves its siblings and nested writing', async () => {
    await withFormatter(async (writing, element) => {
        await settle(() =>
            writing.commands.setContent(
                '<ul><li><p>First</p></li><li><p>Before after</p><ul><li><p>Nested</p></li></ul></li><li><p>Last</p></li></ul>'
            )
        )
        let position = 0
        writing.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.textContent === 'Before after') position = pos + 8
        })
        await chooseFormat(writing, element, 'turn Toggle', position)
        expect(writing.state.doc.textContent).toBe('FirstBefore afterNestedLast')
        expect(writing.getJSON().content?.map((node) => node.type)).toContain('toggle')
        writing.state.doc.check()
    })
})

it('keeps creation inside a toggle body and preserves the summary', async () => {
    await withFormatter(async (writing, element) => {
        await settle(() =>
            writing.commands.setContent(
                '<div data-type="toggle"><div data-type="toggleSummary">Summary</div><div data-type="toggleContent"><p>Before after</p></div></div>'
            )
        )
        let position = 0
        writing.state.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && node.textContent === 'Before after') position = pos + 8
        })
        await chooseFormat(writing, element, 'h1', position)
        const toggle = writing.state.doc.firstChild!
        expect(toggle.type.name).toBe('toggle')
        expect(toggle.lastChild!.content.content.map((node) => node.type.name)).toEqual(['paragraph', 'heading'])
        expect(writing.state.doc.textContent).toBe('SummaryBefore after')
    })
})

it('preserves a completed task when turning it into the same type', async () => {
    await withFormatter(async (writing, element) => {
        await settle(() =>
            writing.commands.setContent(
                '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>'
            )
        )
        const original = writing.getJSON()
        await chooseFormat(writing, element, 'turntodo', 3)
        expect(writing.getJSON()).toEqual(original)
    })
})

it('reuses an empty toggle summary without discarding its body', async () => {
    await withFormatter(async (writing, element) => {
        await settle(() =>
            writing.commands.setContent(
                '<div data-type="toggle"><div data-type="toggleSummary"></div><div data-type="toggleContent"><p>Keep child</p></div></div>'
            )
        )
        await chooseFormat(writing, element, 'h1', 2)
        expect(
            writing
                .getJSON()
                .content?.slice(0, 2)
                .map((node) => node.type)
        ).toEqual(['heading', 'paragraph'])
        expect(writing.state.doc.textContent).toBe('Keep child')
    })
})

it('dismisses formatting without changing writing on Escape', async () => {
    await withFormatter(async (writing, element) => {
        await settle(() => writing.commands.insertContent('Before /turnh1'))
        expect(document.querySelector('.ws-block-menu')).not.toBeNull()
        await settle(() => {
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })
        expect(document.querySelector('.ws-block-menu')).toBeNull()
        expect(writing.state.doc.textContent).toBe('Before /turnh1')
    })
})

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
