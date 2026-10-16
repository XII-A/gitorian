// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { journalExtensions } from '../src/renderer/journal-extensions'

let editor: Editor | undefined
afterEach(() => editor?.destroy())
const toggle = (body = '<p>Inside</p>') =>
    `<div data-type="toggle"><div data-type="toggleSummary">Notes</div><div data-type="toggleContent">${body}</div></div>`
function open(html: string) {
    editor = new Editor({ element: document.createElement('div'), extensions: journalExtensions(), content: html })
    return editor
}
function position(writing: Editor, text: string) {
    let found = -1
    writing.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === text) found = pos
    })
    expect(found).toBeGreaterThan(0)
    return found
}
function select(writing: Editor, text: string) {
    writing.commands.setTextSelection(position(writing, text) + 2)
}
function tab(writing: Editor, shiftKey = false) {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    writing.view.dom.dispatchEvent(event)
    return event.defaultPrevented
}

it.each([
    ['paragraph', '<p>Outside</p>'],
    ['heading', '<h2>Outside</h2>'],
    ['code block', '<pre><code>Outside</code></pre>']
])('keeps unsupported Tab and Shift+Tab in the %s without moving the caret or document', (_name, html) => {
    const writing = open(`${toggle()}<p>Between</p>${html}`)
    select(writing, 'Outside')
    const before = writing.state
    for (const shift of [false, true]) {
        expect(tab(writing, shift)).toBe(true)
        expect(writing.state.doc.eq(before.doc)).toBe(true)
        expect(writing.state.selection.eq(before.selection)).toBe(true)
    }
})

it('consumes Tab and Shift+Tab in a standalone heading with no toggle', () => {
    const writing = open('<h2>Outside</h2>')
    select(writing, 'Outside')
    const before = writing.state
    expect(tab(writing)).toBe(true)
    expect(tab(writing, true)).toBe(true)
    expect(writing.state.doc.eq(before.doc)).toBe(true)
    expect(writing.state.selection.eq(before.selection)).toBe(true)
})

it('consumes an unsupported first-list-item Tab but retains normal list outdent', () => {
    const writing = open(`${toggle()}<p>Between</p><ul><li><p>Outside</p></li></ul>`)
    select(writing, 'Outside')
    const before = writing.state
    expect(tab(writing)).toBe(true)
    expect(writing.state.doc.eq(before.doc)).toBe(true)
    expect(writing.state.selection.eq(before.selection)).toBe(true)
    expect(tab(writing, true)).toBe(true)
    expect(writing.state.doc.child(2).type.name).toBe('paragraph')
    expect(writing.state.doc.child(2).textContent).toBe('Outside')
    expect(writing.state.selection.$from.parentOffset).toBe(2)
})

it('moves a marked paragraph into a preceding collapsed toggle, opens it, and preserves the caret and undo', () => {
    const writing = open(`${toggle()}<p><strong>Outside</strong></p>`)
    const button = writing.view.dom.querySelector('button')!
    button.click()
    select(writing, 'Outside')
    const before = writing.getJSON()
    const caret = writing.state.selection.from
    expect(tab(writing)).toBe(true)
    expect(writing.state.doc.child(1).textContent).toBe('')
    expect(writing.state.doc.firstChild?.lastChild?.lastChild?.textContent).toBe('Outside')
    expect(writing.state.selection.$from.parentOffset).toBe(2)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    writing.commands.undo()
    expect(writing.getJSON()).toEqual(before)
    expect(writing.state.selection.from).toBe(caret)
    writing.commands.redo()
    expect(writing.state.doc.firstChild?.lastChild?.lastChild?.textContent).toBe('Outside')
})

it('outdents the last child without destroying the toggle and supports typing then undo', () => {
    const writing = open(toggle())
    select(writing, 'Inside')
    const before = writing.getJSON()
    expect(tab(writing, true)).toBe(true)
    expect(writing.state.doc.childCount).toBe(3)
    expect(writing.state.doc.firstChild?.type.name).toBe('toggle')
    expect(writing.state.doc.firstChild?.lastChild?.firstChild?.type.name).toBe('paragraph')
    expect(writing.state.doc.child(1).textContent).toBe('Inside')
    expect(writing.state.selection.$from.parentOffset).toBe(2)
    writing.commands.insertContent('X')
    expect(writing.state.doc.child(1).textContent).toBe('InXside')
    writing.commands.undo()
    expect(writing.state.doc.child(1).textContent).toBe('Inside')
    writing.commands.undo()
    expect(writing.getJSON()).toEqual(before)
})

it.each([
    ['bullet', '<ul><li><p>Outside</p></li><li><p>Remaining</p></li></ul>', 'bulletList'],
    ['ordered', '<ol start="4"><li><p>Outside</p></li><li><p>Remaining</p></li></ol>', 'orderedList'],
    [
        'task',
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Outside</p></li><li data-type="taskItem"><p>Remaining</p></li></ul>',
        'taskList'
    ]
])('moves one %s item into and out of a toggle, retaining the other item', (_name, html, type) => {
    const writing = open(`${toggle()}${html}`)
    select(writing, 'Outside')
    expect(tab(writing)).toBe(true)
    expect(writing.state.doc.child(1).textContent).toBe('Remaining')
    const moved = writing.state.doc.firstChild?.lastChild?.lastChild
    expect(moved?.type.name).toBe(type)
    expect(moved?.textContent).toBe('Outside')
    if (type === 'taskList') expect(moved?.firstChild?.attrs.checked).toBe(true)
    if (type === 'orderedList') {
        expect(moved?.attrs.start).toBe(4)
        expect(writing.state.doc.child(1).attrs.start).toBe(5)
    }
    expect(tab(writing, true)).toBe(true)
    expect(writing.state.doc.child(1).type.name).toBe(type)
    expect(writing.state.doc.child(1).textContent).toBe('Outside')
    expect(writing.state.selection.$from.parentOffset).toBe(2)
})

it('outdents a range one toggle level with its following siblings, preserving reading order', () => {
    const writing = open(toggle(`<p>Keep</p>${toggle('<p>First</p><h2>Second</h2><p>Stay</p>')}`))
    writing.commands.setTextSelection({ from: position(writing, 'First'), to: position(writing, 'Second') + 3 })
    expect(tab(writing, true)).toBe(true)
    const outer = writing.state.doc.firstChild?.lastChild
    expect(outer?.childCount).toBe(5)
    expect(outer?.child(1).lastChild?.textContent).toBe('')
    expect(outer?.child(2).textContent).toBe('First')
    expect(outer?.child(3).type.name).toBe('heading')
    expect(outer?.child(4).textContent).toBe('Stay')
    expect(writing.state.doc.child(1).textContent).toBe('')
    expect(writing.state.selection.$from.parent.textContent).toBe('First')
    expect(writing.state.selection.$to.parent.textContent).toBe('Second')
})

it('retains normal list indentation and declines code blocks, readonly editing and composition', () => {
    const writing = open(`${toggle()}<ul><li><p>First</p></li><li><p>Second</p></li></ul><pre><code>Code</code></pre>`)
    select(writing, 'Second')
    expect(tab(writing)).toBe(true)
    expect(writing.state.doc.child(1).firstChild?.lastChild?.type.name).toBe('bulletList')
    select(writing, 'Code')
    const before = writing.getJSON()
    tab(writing)
    expect(writing.getJSON()).toEqual(before)
    select(writing, 'Inside')
    writing.setEditable(false)
    expect(tab(writing, true)).toBe(false)
    expect(writing.getJSON()).toEqual(before)
    writing.setEditable(true)
    Object.defineProperty(writing.view, 'composing', { configurable: true, get: () => true })
    expect(tab(writing, true)).toBe(false)
    expect(writing.getJSON()).toEqual(before)
})

it('moves a selected list node without treating the selection as a partial list item', () => {
    const writing = open(`${toggle()}<ul><li><p>Outside</p></li></ul>`)
    writing.commands.setNodeSelection(writing.state.doc.firstChild!.nodeSize)
    expect(tab(writing)).toBe(true)
    expect(writing.state.doc.firstChild?.lastChild?.lastChild?.type.name).toBe('bulletList')
    expect(writing.state.selection.constructor.name).toBe('NodeSelection')
})
