// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDiff, type TokenNode } from 'react-diff-view'
import { sharedIndent, indentColumns, presentationTokens, selectedSource } from '../src/renderer/diff-presentation'
import { highlightDiff } from '../src/renderer/diff-syntax'
import { loadDiff } from '../src/renderer/diff-loader'
import { DiffViewer } from '../src/renderer/DiffViewer'

const patch =
    'diff --git a/view.tsx b/view.tsx\n--- a/view.tsx\n+++ b/view.tsx\n@@ -1,3 +1,3 @@\n     <div>\n-        before\n+            after\n     </div>\n@@ -10,1 +10,1 @@\n-  old\n+    new\n'
const text = (nodes: TokenNode[]): string =>
    nodes.map((node) => (node.type === 'text' ? node.value : text(node.children ?? []))).join('')

describe('diff presentation', () => {
    it('finds a shared whitespace prefix without flattening nesting or ignoring either side', () => {
        expect(sharedIndent(['    outer', '', '        inner', '      changed'])).toBe('    ')
        expect(sharedIndent(['    old', '  new'])).toBe('  ')
        expect(sharedIndent(['\t  old', '\t    new'])).toBe('\t  ')
        expect(sharedIndent(['\told', '    new'])).toBe('')
        expect(sharedIndent(['', '   '])).toBe('')
        expect(indentColumns(' \t  ')).toBe(6)
    })
    it('compacts each hunk independently and preserves original highlighted text and line numbers', () => {
        const [file] = parseDiff(patch)
        const original = structuredClone(file)
        const highlighted = highlightDiff(file)!
        const display = presentationTokens(file, highlighted, true)
        expect(display.old[0][0].indentColumns).toBe(4)
        expect(display.new[1][0].indentColumns).toBe(4)
        expect(display.new[9][0].indentColumns).toBe(2)
        expect(display.old.map(text)).toEqual(highlighted.old.map(text))
        expect(display.new.map(text)).toEqual(highlighted.new.map(text))
        expect(file).toEqual(original)
        expect(presentationTokens(file, undefined, false).new[1][0].indentColumns).toBe(0)
    })
    it('defaults the real viewer to wrapped compact lines and copies the original indentation', async () => {
        await loadDiff(patch)
        const root = document.createElement('div')
        root.innerHTML = renderToStaticMarkup(createElement(DiffViewer, { text: patch }))
        expect(root.querySelector('.ws-diff-viewer')?.getAttribute('data-wrap')).toBe('true')
        expect(root.querySelector('[aria-label="Diff display options"]')).not.toBeNull()
        const lines = root.querySelectorAll<HTMLElement>('.ws-diff-source-line')
        expect(lines[0].textContent).toBe('    <div>')
        expect(lines[0].dataset.indentCharacters).toBe('4')
        const range = document.createRange()
        range.setStart(lines[0].firstChild!, 4)
        range.setEnd(lines[2].firstChild!, lines[2].textContent.length)
        expect(selectedSource(range, root)).toBe('    <div>\n        before\n            after')
        range.setStart(lines[1].firstChild!, 10)
        range.setEnd(lines[1].firstChild!, 14)
        expect(selectedSource(range, root)).toBe('fore')
    })
    it('retains empty lines and excludes line numbers from copied selections', () => {
        const root = document.createElement('div')
        root.innerHTML =
            '<span class="ws-diff-source-line" data-indent-characters="4">    start</span><span>12</span><span class="ws-diff-source-line"></span><span class="ws-diff-source-line" data-indent-characters="4">    end</span>'
        const range = document.createRange()
        range.selectNodeContents(root)
        expect(selectedSource(range, root)).toBe('    start\n\n    end')
    })
})
