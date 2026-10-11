import { describe, expect, it } from 'vitest'
import { parseDiff, type TokenNode } from 'react-diff-view'
import { highlightDiff } from '../src/renderer/diff-syntax'
import { loadDiff, loadDiffTokens } from '../src/renderer/diff-loader'

function patch(path: string, before: string[], after: string[]) {
    return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${before.length} +1,${after.length} @@\n${before.map((line) => `-${line}`).join('\n')}\n${after.map((line) => `+${line}`).join('\n')}\n`
}

function tokenText(nodes: TokenNode[]): string {
    return nodes.map((node) => (node.type === 'text' ? node.value : tokenText(node.children ?? []))).join('')
}

function tokenClasses(nodes: TokenNode[]): string[] {
    return nodes.flatMap((node) =>
        node.type === 'text' ? [] : [...(node.properties.className ?? []), ...tokenClasses(node.children ?? [])]
    )
}

describe('diff syntax highlighting', () => {
    it.each(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'])(
        'highlights both sides of %s without changing code text',
        (extension) => {
            const before = ['// Previous value', 'const message = "before"']
            const after = ['// Updated value', 'const message = "after"']
            const [file] = parseDiff(patch(`src/message.${extension}`, before, after))
            const tokens = highlightDiff(file)!
            expect(tokens.old.map(tokenText)).toEqual(before)
            expect(tokens.new.map(tokenText)).toEqual(after)
            expect(tokenClasses(tokens.new.flat())).toEqual(expect.arrayContaining(['keyword', 'string', 'comment']))
        }
    )
    it.each(['tsx', 'jsx'])('highlights JSX tags in %s and keeps literal markup safe', (extension) => {
        const before = ['const node = <Button label="Before" />']
        const after = ['const node = <Button label="After">Hello</Button>']
        const [file] = parseDiff(patch(`src/view.${extension}`, before, after))
        const tokens = highlightDiff(file)!
        expect(tokens.new.map(tokenText)).toEqual(after)
        expect(tokenClasses(tokens.new.flat())).toEqual(expect.arrayContaining(['tag', 'attr-name', 'attr-value']))
    })
    it('uses the old path for deleted files and declines unsupported files', () => {
        const [file] = parseDiff(patch('src/file.ts', ['const count = 1'], ['const count = 2']))
        expect(highlightDiff({ ...file, newPath: '/dev/null' })).toBeDefined()
        expect(highlightDiff({ ...file, newPath: 'README.md' })).toBeUndefined()
        expect(highlightDiff({ ...file, hunks: [] })).toBeUndefined()
    })
    it('does not highlight files beyond the existing display limit', () => {
        const [file] = parseDiff(
            patch(
                'src/large.ts',
                ['const count = 0'],
                Array.from({ length: 4000 }, () => 'const count = 1')
            )
        )
        expect(highlightDiff(file)).toBeUndefined()
    })
    it('coalesces parsing and highlighting requests and reuses the same cached tokens', async () => {
        const text = patch('cached.ts', ['const count = 1'], ['const count = 2'])
        const first = loadDiff(text)
        expect(loadDiff(text)).toBe(first)
        const [file] = await first
        const highlighted = loadDiffTokens(file)
        expect(loadDiffTokens(file)).toBe(highlighted)
        const tokens = await highlighted
        expect(tokens).toBeDefined()
        expect(await loadDiffTokens(file)).toBe(tokens)
    })
})
