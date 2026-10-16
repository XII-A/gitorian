// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { journalExtensions } from '../src/renderer/journal-extensions'
import { journalFromHTML, journalHTML } from '../src/renderer/workspace-model'
import { plainText } from '../src/shared/notion-format'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

function open(content = '<p>First thought</p>') {
    editor = new Editor({ element: document.createElement('div'), extensions: journalExtensions(), content })
    return editor
}

it('keeps Enter as a separate paragraph and Shift+Enter as a hard break after reload', () => {
    const writing = open()
    writing.commands.setTextSelection(14)
    writing.commands.keyboardShortcut('Enter')
    writing.commands.insertContent('Second thought')
    writing.commands.keyboardShortcut('Shift-Enter')
    writing.commands.insertContent('Next line')
    const body = writing.getJSON()
    expect(body.content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
    expect(body.content?.[1].content?.map((node) => node.type)).toEqual(['text', 'hardBreak', 'text'])
    writing.commands.setContent(body)
    expect(writing.getHTML()).toBe('<p>First thought</p><p>Second thought<br>Next line</p>')
})

it('retains blank blocks and hard breaks without cleaning them out of saved writing', () => {
    const writing = open('<p>First<br>Next</p><p></p><p></p>')
    const saved = writing.getJSON()
    writing.commands.setContent(saved)
    expect(writing.getJSON()).toEqual(saved)
    expect(saved.content).toHaveLength(3)
    expect(journalFromHTML(journalHTML(saved)).content).toHaveLength(3)
})

it('supports heading four, toggles, nested content, and inline code across serialization', () => {
    const writing = open(
        '<h4>Small heading</h4><div data-type="toggle"><div data-type="toggleSummary">Notes</div><div data-type="toggleContent"><p><code>run()</code></p></div></div>'
    )
    const saved = writing.getJSON()
    expect(saved.content?.[0].attrs?.level).toBe(4)
    expect(saved.content?.[1].type).toBe('toggle')
    expect(plainText(saved)).toContain('run()')
    expect(journalFromHTML(journalHTML(saved))).toEqual(saved)
    const toggle = writing.view.dom.querySelector('[data-type="toggle"]')!
    const button = toggle.querySelector('button')!
    button.click()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(writing.getJSON()).toEqual(saved)
    // Entering a collapsed summary opens its body before moving the caret.
    writing.state.doc.descendants((node, position) => {
        if (node.type.name === 'toggleSummary') writing.commands.setTextSelection(position + 1)
    })
    writing.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(writing.state.selection.$from.parent.type.name).toBe('paragraph')
})

it('recognizes backtick inline code as it is typed', () => {
    const writing = open('<p>`run()</p>')
    writing.commands.setTextSelection(7)
    writing.view.someProp('handleTextInput', (handler) =>
        handler(writing.view, 7, 7, '`', () => writing.state.tr.insertText('`', 7))
    )
    expect(writing.getJSON().content?.[0].content).toEqual([{ type: 'text', text: 'run()', marks: [{ type: 'code' }] }])
})

it('unwraps a toggle with Backspace at the start of its summary without losing its children', () => {
    const writing = open(
        '<div data-type="toggle"><div data-type="toggleSummary">Notes</div><div data-type="toggleContent"><p>Keep this text</p></div></div>'
    )
    writing.commands.setTextSelection(2)
    writing.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(
        writing
            .getJSON()
            .content?.filter((node) => node.content?.length)
            .map((node) => node.type)
    ).toEqual(['paragraph', 'paragraph'])
    expect(writing.getText()).toContain('Notes')
    expect(writing.getText()).toContain('Keep this text')
    writing.commands.undo()
    expect(writing.getJSON().content?.[0].type).toBe('toggle')
})

it.each(['Backspace', 'Delete'])('removes a newly inserted empty toggle with %s and supports undo', (key) => {
    const writing = open(
        '<div data-type="toggle"><div data-type="toggleSummary"></div><div data-type="toggleContent"><p></p></div></div>'
    )
    writing.commands.setTextSelection(2)
    writing.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    expect(writing.getJSON().content?.some((node) => node.type === 'toggle')).toBe(false)
    writing.commands.undo()
    expect(writing.getJSON().content?.[0].type).toBe('toggle')
})

it('unwraps from the first body paragraph while preserving the summary and body', () => {
    const writing = open(
        '<div data-type="toggle"><div data-type="toggleSummary">Notes</div><div data-type="toggleContent"><p>Keep this text</p></div></div>'
    )
    let position = 0
    writing.state.doc.descendants((node, offset) => {
        if (node.type.name === 'toggleContent') position = offset + 2
    })
    writing.commands.setTextSelection(position)
    writing.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(writing.getJSON().content?.some((node) => node.type === 'toggle')).toBe(false)
    expect(writing.getText()).toContain('Notes')
    expect(writing.getText()).toContain('Keep this text')
})

it.each(['beforeinput', 'ctrl'])('protects the paragraph above a toggle during word deletion (%s)', (input) => {
    const writing = open(
        '<p>Keep the previous line</p><div data-type="toggle"><div data-type="toggleSummary">Toggle notes</div><div data-type="toggleContent"><p>Keep the body</p></div></div>'
    )
    let summary = 0
    writing.state.doc.descendants((node, position) => {
        if (node.type.name === 'toggleSummary') summary = position + 1
    })
    writing.commands.setTextSelection(summary)
    const event = new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true })
    if (input === 'ctrl') writing.view.dom.dispatchEvent(event)
    else
        writing.view.dom.dispatchEvent(
            new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true })
        )
    expect(writing.getJSON().content?.some((node) => node.type === 'toggle')).toBe(false)
    expect(writing.state.doc.firstChild?.textContent).toBe('Keep the previous line')
    expect(writing.getText()).toContain('Toggle notes')
    expect(writing.getText()).toContain('Keep the body')
})

it.each(['beforeinput', 'ctrl'])('deletes words inside the toggle before safely removing its wrapper (%s)', (input) => {
    const writing = open(
        '<p>Keep the previous line</p><div data-type="toggle"><div data-type="toggleSummary">Toggle notes</div><div data-type="toggleContent"><p>Keep the body</p></div></div>'
    )
    let summary = 0
    writing.state.doc.descendants((node, position) => {
        if (node.type.name === 'toggleSummary') summary = position + 1
    })
    writing.commands.setTextSelection(summary + 'Toggle notes'.length)
    const remove = () =>
        writing.view.dom.dispatchEvent(
            input === 'ctrl'
                ? new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true })
                : new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true })
        )
    remove()
    expect(writing.state.doc.child(1).firstChild?.textContent).toBe('Toggle ')
    remove()
    remove()
    expect(writing.getJSON().content?.some((node) => node.type === 'toggle')).toBe(false)
    expect(writing.state.doc.firstChild?.textContent).toBe('Keep the previous line')
    expect(writing.getText()).toContain('Keep the body')
    writing.commands.undo()
    expect(writing.state.doc.firstChild?.textContent).toBe('Keep the previous line')
})
