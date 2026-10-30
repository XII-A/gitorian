// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { Editor, generateJSON } from '@tiptap/react'
import { journalExtensions } from '../src/renderer/journal-extensions'
import { portableWriting } from '../src/shared/journal-direction'
import {
    insertPlainWriting,
    loadWriting,
    selectedWritingDirection,
    setWritingDirection
} from '../src/renderer/journal-direction'
import { applyBlockFormat } from '../src/renderer/block-format'

let editor: Editor
afterEach(() => editor?.destroy())
function open() {
    editor = new Editor({
        element: document.createElement('div'),
        extensions: journalExtensions(),
        content: '<p>مرحبا بالعالم</p><p>Türkçe: ç ğ ı İ ö ş ü</p>'
    })
    return editor
}
it('persists document policy and block overrides with undo, conversion and reset', () => {
    const e = open()
    expect(setWritingDirection(e, { scope: 'document' }, 'rtl')).toBe(true)
    e.commands.setTextSelection(e.state.doc.firstChild!.nodeSize + 1)
    setWritingDirection(e, { scope: 'selection' }, 'ltr')
    expect(e.getJSON().attrs?.direction).toBe('rtl')
    expect(e.state.selection.$from.parent.attrs.direction).toBe('ltr')
    applyBlockFormat(e, 'heading2', { from: e.state.selection.from, to: e.state.selection.to }, true)
    expect(e.state.selection.$from.parent.attrs.direction).toBe('ltr')
    setWritingDirection(e, { scope: 'selection' }, null)
    expect(e.state.selection.$from.parent.attrs.direction).toBeNull()
    e.commands.undo()
    expect(e.state.selection.$from.parent.attrs.direction).toBe('ltr')
    const saved = e.getJSON()
    e.commands.setContent(saved)
    expect(e.getJSON()).toEqual(saved)
})
it('transfers inherited source policy without freezing automatic direction', () => {
    expect(
        portableWriting({
            type: 'doc',
            attrs: { direction: 'rtl' },
            content: [{ type: 'paragraph' }, { type: 'paragraph', attrs: { direction: 'auto' } }]
        })
    ).toEqual([
        { type: 'paragraph', attrs: { direction: 'rtl' } },
        { type: 'paragraph', attrs: { direction: 'auto' } }
    ])
})
it('does not mutate writing in a read-only editor', () => {
    const e = open()
    e.setEditable(false)
    expect(setWritingDirection(e, { scope: 'document' }, 'rtl')).toBe(false)
    expect(e.getJSON().attrs?.direction).not.toBe('rtl')
})

it('keeps automatic direction on untouched neighboring paragraphs after editing another block', () => {
    const e = open()
    e.commands.setTextSelection(2)
    setWritingDirection(e, { scope: 'selection' }, 'rtl')
    e.commands.insertContent('X')
    expect(e.view.dom.querySelectorAll('p')[1].getAttribute('dir')).toBe('auto')
    e.commands.setTextSelection(e.state.doc.firstChild!.nodeSize + 1)
    setWritingDirection(e, { scope: 'selection' }, 'auto')
    expect(e.view.dom.querySelector('p')?.getAttribute('dir')).toBe('rtl')
})

it('retains automatic rendering when identical paragraphs are inserted and removed', () => {
    const e = open()
    e.commands.setContent('<p>A</p><p>A</p>')
    e.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'A' }] })
    const policies = () => [...e.view.dom.querySelectorAll('p')].map((node) => node.getAttribute('dir'))
    expect(policies()).toEqual(['auto', 'auto', 'auto'])
    e.commands.deleteRange({ from: 0, to: 3 })
    expect(policies()).toEqual(['auto', 'auto'])
})

it('retains direction on toggle serialization, conversion and diacritized word deletion', () => {
    const e = open()
    e.commands.setContent(
        '<div data-type="toggle"><div data-type="toggleSummary" dir="rtl">قبل العَرَبِيَّة</div><div data-type="toggleContent"><p>Body</p></div></div>'
    )
    let end = 0
    e.state.doc.descendants((node, pos) => {
        if (node.type.name === 'toggleSummary') end = pos + 1 + node.content.size
    })
    e.commands.setTextSelection(end)
    e.commands.keyboardShortcut('Ctrl-Backspace')
    expect(e.state.selection.$from.parent.textContent).toBe('قبل ')
    expect(generateJSON(e.getHTML(), journalExtensions()).content?.[0].content?.[0].attrs?.direction).toBe('rtl')
    expect(e.getHTML()).toContain('dir="rtl"')
    e.commands.setTextSelection(e.state.selection.$from.start())
    e.commands.keyboardShortcut('Backspace')
    expect(e.state.doc.firstChild!.type.name).toBe('paragraph')
    expect(e.state.doc.firstChild!.attrs.direction).toBe('rtl')
})

it('keeps explicit paragraph policy when splitting and resets prose policy when converting to code', () => {
    const e = open()
    e.commands.setTextSelection(3)
    setWritingDirection(e, { scope: 'selection' }, 'rtl')
    e.commands.splitBlock()
    expect(e.state.selection.$from.parent.attrs.direction).toBe('rtl')
    applyBlockFormat(e, 'code', e.state.selection, true)
    expect(e.state.selection.$from.parent.type.name).toBe('codeBlock')
    expect(e.state.selection.$from.parent.attrs.direction).toBeUndefined()
})

it('keeps policy through typed Markdown headings and offers bulk reset for whole-document selections', () => {
    const e = open()
    e.commands.setContent('<p dir="rtl">#</p><p dir="ltr">Second</p>')
    e.commands.setTextSelection(2)
    e.view.someProp('handleTextInput', (handler) => handler(e.view, 2, 2, ' ', () => e.state.tr.insertText(' ')))
    expect(e.state.doc.firstChild!.type.name).toBe('heading')
    expect(e.state.doc.firstChild!.attrs.direction).toBe('rtl')
    e.commands.selectAll()
    expect(selectedWritingDirection(e)).toBe('mixed')
    setWritingDirection(e, { scope: 'selection' }, null)
    expect(selectedWritingDirection(e)).toBeNull()
})

it('keeps destination policy at partial multi-block paste edges and source policy in complete interior blocks', () => {
    const e = open()
    loadWriting(e, {
        type: 'doc',
        attrs: { direction: 'rtl' },
        content: ['First', 'Middle', 'Last'].map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }))
    })
    e.commands.setTextSelection({ from: 3, to: 19 })
    const html = e.view.serializeForClipboard(e.state.selection.content()).dom.innerHTML
    loadWriting(e, {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { direction: 'auto' }, content: [{ type: 'text', text: 'BeforeAfter' }] }]
    })
    e.commands.setTextSelection(7)
    e.view.pasteHTML(html)
    const nodes = e.getJSON().content
    expect(nodes.map((node) => node.attrs?.direction)).toEqual(['auto', 'rtl', 'auto'])
    expect(e.getText()).toBe('Beforerst\n\nMiddle\n\nLasAfter')
})

it('imports inherited semantic HTML direction while honoring explicit automatic exceptions', () => {
    const e = open()
    e.commands.setContent(
        '<div dir="RTL"><p>English project</p><p dir="AUTO">Automatic exception</p><div dir="invalid"><p>Inherited</p></div></div>'
    )
    expect(e.getJSON().content?.map((node) => node.attrs?.direction)).toEqual(['rtl', 'auto', 'rtl'])
})

it('plain text and formatted plain input use the destination override across interior blocks', () => {
    const e = open()
    const target = {
        type: 'doc',
        attrs: { direction: 'rtl' },
        content: [{ type: 'paragraph', attrs: { direction: 'ltr' }, content: [{ type: 'text', text: 'BeforeAfter' }] }]
    }
    loadWriting(e, target)
    e.commands.setTextSelection(7)
    e.view.pasteText('First\nMiddle\nLast')
    expect(e.getJSON().content.map((node) => node.attrs?.direction)).toEqual(['ltr', 'ltr', 'ltr'])
    loadWriting(e, target)
    e.commands.setTextSelection(7)
    insertPlainWriting(e, '<p><strong>First</strong></p><p>Middle</p><p>Last</p>')
    expect(
        e
            .getJSON()
            .content.filter((node) => node.type === 'paragraph')
            .every((node) => node.attrs?.direction === 'ltr')
    ).toBe(true)
    expect(e.getText()).toContain('Middle')
})

it('whole-document plain replacement keeps inheritance when the document default changes later', () => {
    const e = open()
    setWritingDirection(e, { scope: 'document' }, 'rtl')
    e.commands.selectAll()
    e.view.pasteText('First\nSecond')
    expect(e.getJSON().content.map((node) => node.attrs?.direction)).toEqual([null, null])
    setWritingDirection(e, { scope: 'document' }, 'ltr')
    expect([...e.view.dom.querySelectorAll('p')].every((node) => node.getAttribute('dir') === 'ltr')).toBe(true)
    setWritingDirection(e, { scope: 'document' }, 'rtl')
    e.commands.selectAll()
    insertPlainWriting(e, '<p><strong>First</strong></p><p>Second</p>')
    expect(e.getJSON().content.map((node) => node.attrs?.direction)).toEqual([null, null])
})
