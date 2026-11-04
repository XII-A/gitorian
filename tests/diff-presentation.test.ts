// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { sharedIndent, indentColumns } from '../src/renderer/diff-model'
import { selectedSource, sourceSelection } from '../src/renderer/diff-selection'

it('compacts shared indentation without flattening nested or mixed whitespace', () => {
    expect(sharedIndent(['    outer', '', '        inner', '      changed'])).toBe('    ')
    expect(sharedIndent(['\told', '    new'])).toBe('')
    expect(sharedIndent(['', '   '])).toBe('')
    expect(indentColumns(' \t  ')).toBe(6)
})

it('uses the composed shadow range when Chromium reports the document selection as collapsed', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML =
        '<code data-code><div data-line>first</div><div data-line>\n</div><div data-line>last</div></code>'
    const lines = shadow.querySelectorAll('[data-line]')
    const range = document.createRange()
    range.setStart(lines[0].firstChild!, 0)
    range.setEnd(lines[2].firstChild!, 4)
    const selection = window.getSelection()!
    selection.collapse(document.body, 0)
    Object.defineProperty(selection, 'getComposedRanges', { configurable: true, value: () => [range] })
    try {
        expect(selection.isCollapsed).toBe(true)
        expect(sourceSelection(shadow)).toBe('first\n\nlast')
    } finally {
        Reflect.deleteProperty(selection, 'getComposedRanges')
        selection.removeAllRanges()
        host.remove()
    }
})
it('copies native partial selections from Shadow DOM, retaining blank lines and restoring cropped indentation', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML =
        '<code data-code><div data-line data-indent-characters="4">    start</div><div data-line>\n</div><div data-line data-indent-characters="4">    end</div></code><div>12</div>'
    const lines = shadow.querySelectorAll('[data-line]')
    const range = document.createRange()
    range.setStart(lines[0].firstChild!, 4)
    range.setEnd(lines[2].firstChild!, 7)
    expect(selectedSource(range, shadow)).toBe('    start\n\n    end')
    range.setStart(lines[0].firstChild!, 5)
    range.setEnd(lines[0].firstChild!, 8)
    expect(selectedSource(range, shadow)).toBe('tar')
})
