// @vitest-environment happy-dom
import { createElement } from 'react'
import type { TokenNode } from 'react-diff-view'
import { parseDiff } from 'react-diff-view'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { loadDiff } from '../src/renderer/diff-loader'
import { indentColumns, presentationTokens, selectedSource, sharedIndent } from '../src/renderer/diff-presentation'
import { highlightDiff } from '../src/renderer/diff-syntax'
import { DiffViewer } from '../src/renderer/diff-viewer'
import { required } from '../src/shared/required'

const patch =
    'diff --git a/view.tsx b/view.tsx\n--- a/view.tsx\n+++ b/view.tsx\n@@ -1,3 +1,3 @@\n     <div>\n-        before\n+            after\n     </div>\n@@ -10,1 +10,1 @@\n-  old\n+    new\n'
const text = (nodes: TokenNode[]): string =>
    nodes.map((node) => (node.type === 'text' ? node.value : text(node.children ?? []))).join('')

describe('diff presentation', () => {
    it('finds a shared whitespace prefix without flattening nesting or ignoring either side', () => {
        expect([
            Object.is(sharedIndent(['    outer', '', '        inner', '      changed']), '    '),
            Object.is(sharedIndent(['    old', '  new']), '  '),
            Object.is(sharedIndent(['\t  old', '\t    new']), '\t  '),
            Object.is(sharedIndent(['\told', '    new']), ''),
            Object.is(sharedIndent(['', '   ']), ''),
            Object.is(indentColumns(' \t  '), 6)
        ]).toStrictEqual([true, true, true, true, true, true])
    })

    it('compacts each hunk independently and preserves original highlighted text and line numbers', () => {
        const [file] = parseDiff(patch)
        const original = structuredClone(file)
        const highlighted = required(highlightDiff(file))
        const display = presentationTokens(file, highlighted, true)
        expect([
            Object.is(display.old[0][0].indentColumns, 4),
            Object.is(display.new[1][0].indentColumns, 4),
            Object.is(display.new[9][0].indentColumns, 2),
            display.old.map(text),
            display.new.map(text),
            file,
            Object.is(presentationTokens(file, undefined, false).new[1][0].indentColumns, 0)
        ]).toStrictEqual([true, true, true, highlighted.old.map(text), highlighted.new.map(text), original, true])
    })

    it('defaults the real viewer to wrapped compact lines and copies the original indentation', async () => {
        await loadDiff(patch)
        const root = document.createElement('div')
        root.innerHTML = renderToStaticMarkup(createElement(DiffViewer, { text: patch }))
        expect([
            root.querySelector<HTMLElement>('.ws-diff-viewer')?.dataset.wrap,
            root.querySelector('[aria-label="Diff display options"]') === null
        ]).toStrictEqual(['true', false])
        const lines = root.querySelectorAll<HTMLElement>('.ws-diff-source-line')
        expect([
            Object.is(lines[0].textContent, '    <div>'),
            Object.is(lines[0].dataset.indentCharacters, '4')
        ]).toStrictEqual([true, true])
        const range = document.createRange()
        range.setStart(required(lines[0].firstChild), 4)
        range.setEnd(required(lines[2].firstChild), lines[2].textContent.length)
        expect(selectedSource(range, root)).toBe('    <div>\n        before\n            after')
        range.setStart(required(lines[1].firstChild), 10)
        range.setEnd(required(lines[1].firstChild), 14)
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
