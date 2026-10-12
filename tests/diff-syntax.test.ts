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
    it('highlights SQL keywords, strings, numbers, and comments without changing either side', () => {
        const before = ['-- Previous query', "SELECT name FROM users WHERE status = 'old' AND id = 1;"]
        const after = ['-- Updated query', "SELECT name FROM users WHERE status = 'active' AND id = 2;"]
        const [file] = parseDiff(patch('migration.SQL', before, after))
        const tokens = highlightDiff(file)!
        expect(tokens.old.map(tokenText)).toEqual(before)
        expect(tokens.new.map(tokenText)).toEqual(after)
        expect(tokenClasses(tokens.new.flat())).toEqual(
            expect.arrayContaining(['keyword', 'string', 'number', 'comment'])
        )
    })
    it.each(['yml', 'yaml'])(
        'highlights %s keys and values while preserving indentation on both sides',
        (extension) => {
            const before = ['# Previous config', 'service:', '  name: "before"', '  enabled: false', '  retries: 1']
            const after = ['# Updated config', 'service:', '  name: "after"', '  enabled: true', '  retries: 2']
            const [file] = parseDiff(patch(`config.${extension}`, before, after))
            const tokens = highlightDiff(file)!
            expect(tokens.old.map(tokenText)).toEqual(before)
            expect(tokens.new.map(tokenText)).toEqual(after)
            expect(tokenClasses(tokens.new.flat())).toEqual(
                expect.arrayContaining(['key', 'string', 'boolean', 'number', 'comment'])
            )
        }
    )
    it.each(['json', 'jsonc', 'webmanifest'])(
        'highlights %s keys and values without changing either side',
        (extension) => {
            const before = ['{', '  "name": "before", "enabled": false, "count": 1, "value": null', '}']
            const after = [
                '{',
                '  "name": "<script>alert(1)</script>", "enabled": true, "count": 2, "value": null',
                '}'
            ]
            const [file] = parseDiff(patch(`config.${extension}`, before, after))
            const tokens = highlightDiff(file)!
            expect(tokens.old.map(tokenText)).toEqual(before)
            expect(tokens.new.map(tokenText)).toEqual(after)
            expect(tokenClasses(tokens.new.flat())).toEqual(
                expect.arrayContaining(['property', 'string', 'boolean', 'number', 'keyword'])
            )
        }
    )
    it.each(['md', 'markdown'])('highlights %s source while preserving Markdown syntax on both sides', (extension) => {
        const before = ['# Before', '', '- **Strong** and *emphasis* with `code`', '[Docs](https://example.com/before)']
        const after = [
            '# After',
            '',
            '- **Updated** and *emphasis* with `code`',
            '[Docs](https://example.com/after)',
            '```json',
            '{"count": 2}',
            '```'
        ]
        const [file] = parseDiff(patch(`README.${extension}`, before, after))
        const tokens = highlightDiff(file)!
        expect(tokens.old.map(tokenText)).toEqual(before)
        expect(tokens.new.map(tokenText)).toEqual(after)
        expect(tokenClasses(tokens.new.flat())).toEqual(
            expect.arrayContaining(['title', 'bold', 'italic', 'code-snippet', 'url', 'code-language', 'code-block'])
        )
    })
    it('highlights CSS selectors, properties, and values while preserving both sides', () => {
        const before = ['/* Previous style */', '.panel { color: red; gap: 8px; }']
        const after = ['/* Updated style */', '.panel:hover { color: blue; gap: 12px; }']
        const [file] = parseDiff(patch('src/panel.css', before, after))
        const tokens = highlightDiff(file)!
        expect(tokens.old.map(tokenText)).toEqual(before)
        expect(tokens.new.map(tokenText)).toEqual(after)
        expect(tokenClasses(tokens.new.flat())).toEqual(expect.arrayContaining(['selector', 'property', 'comment']))
    })
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
        expect(highlightDiff({ ...file, newPath: 'image.svg' })).toBeUndefined()
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
