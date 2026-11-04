// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { sharedIndent, indentColumns } from '../src/renderer/diff-model'
import { selectedSource } from '../src/renderer/diff-selection'

it('compacts shared indentation without flattening nested or mixed whitespace', () => {
    expect(sharedIndent(['    outer', '', '        inner', '      changed'])).toBe('    ')
    expect(sharedIndent(['\told', '    new'])).toBe('')
    expect(sharedIndent(['', '   '])).toBe('')
    expect(indentColumns(' \t  ')).toBe(6)
})
it('copies native partial selections from Shadow DOM, retaining blank lines and restoring cropped indentation', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML =
        '<code data-code><div data-line data-indent-characters="4">    start</div><div data-line></div><div data-line data-indent-characters="4">    end</div></code><div>12</div>'
    const lines = shadow.querySelectorAll('[data-line]')
    const range = document.createRange()
    range.setStart(lines[0].firstChild!, 4)
    range.setEnd(lines[2].firstChild!, 7)
    expect(selectedSource(range, shadow)).toBe('    start\n\n    end')
    range.setStart(lines[0].firstChild!, 5)
    range.setEnd(lines[0].firstChild!, 8)
    expect(selectedSource(range, shadow)).toBe('tar')
})
