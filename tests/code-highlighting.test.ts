import { describe, expect, it } from 'vitest'
import { codeLexer, codeLanguageChoices, loadCodeHighlighting } from '../src/renderer/code-highlighting'

describe('shared code highlighting', () => {
    it('resolves actual JSX/TSX and provider aliases without guessing unknown languages', () => {
        expect(codeLexer('tsx')).toBe('tsx')
        expect(codeLexer('jsx')).toBe('jsx')
        expect(codeLexer('c#')).toBe('csharp')
        expect(codeLexer('plain text')).toBeUndefined()
        expect(codeLexer('custom-language')).toBeUndefined()
        expect(codeLexer('__proto__')).toBeUndefined()
        expect(codeLanguageChoices).toContain('typescript')
    })
    it.each([
        ['sql', "SELECT name FROM users WHERE id = 2 AND state = 'active';"],
        ['yaml', 'service:\n  enabled: true\n  name: "worker"'],
        ['json', '{"enabled":true,"name":"<script>literal</script>"}'],
        ['markdown', '# Heading\n\n**Strong** and `code`'],
        ['css', '.panel:hover { color: red; gap: 8px; }'],
        ['tsx', 'const view = <Button label="After">Hello</Button>']
    ])('styles %s while keeping authored text authoritative', async (language, source) => {
        const runtime = await loadCodeHighlighting()
        expect(runtime.status).toBe('ready')
        if (runtime.status !== 'ready') return
        const runs = runtime.highlight(source, language)
        expect(runs.length).toBeGreaterThan(0)
        expect(runs.every((run) => run.from >= 0 && run.to <= source.length)).toBe(true)
        expect(runs.some((run) => run.style.color?.includes('--code-token-'))).toBe(true)
    })
    it('preserves exact Unicode, whitespace and multiline source through owned UTF-16 ranges', async () => {
        const runtime = await loadCodeHighlighting()
        expect(runtime.status).toBe('ready')
        if (runtime.status !== 'ready') return
        const source = '// 😀 é\r\n\tconst value = `<raw>\nmore`;\n'
        const runs = runtime.highlight(source, 'typescript')
        expect(runs.length).toBeGreaterThan(0)
        for (const run of runs) {
            expect(run.from).toBeGreaterThanOrEqual(0)
            expect(run.to).toBeLessThanOrEqual(source.length)
            expect(source.slice(run.from, run.to)).not.toBe('')
        }
        expect(runs.some((run) => run.style.color?.includes('token-keyword'))).toBe(true)
        expect(runtime.highlight(source, 'custom-language')).toEqual([])
        expect(runtime.highlight(source, null)).toEqual([])
        expect(runtime.highlight('x'.repeat(250_001), 'typescript')).toEqual([])
    })
})
