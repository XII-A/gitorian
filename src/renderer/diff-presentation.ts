import { tokenize, type FileData, type HunkTokens, type TokenNode } from 'react-diff-view'

/** Use the same prefix for both sides, so indentation-only changes remain visible. */
export function sharedIndent(lines: string[]): string {
    const prefixes = lines.filter((line) => line.trim()).map((line) => /^[\t ]*/.exec(line)?.[0] ?? '')
    return prefixes.reduce((prefix, next) => {
        let length = 0
        while (length < prefix.length && prefix[length] === next[length]) length++
        return prefix.slice(0, length)
    }, prefixes[0] ?? '')
}

export function indentColumns(prefix: string): number {
    return prefix.split('').reduce((column, character) => column + (character === '\t' ? 4 - (column % 4) : 1), 0)
}

/** Wrap original tokens without changing source text, line numbers, or highlighting. */
export function presentationTokens(file: FileData, highlighted: HunkTokens | undefined, compact: boolean): HunkTokens {
    const source = highlighted ?? tokenize(file.hunks)
    const result = { old: source.old.slice(), new: source.new.slice() }
    for (const hunk of file.hunks) {
        const prefix = compact ? sharedIndent(hunk.changes.map((change) => change.content)) : ''
        for (const change of hunk.changes) {
            const wrap = (side: 'old' | 'new', line: number) => {
                const removed = change.content.startsWith(prefix) ? prefix : ''
                const token: TokenNode = {
                    type: 'source-line',
                    indentCharacters: removed.length,
                    indentColumns: indentColumns(removed),
                    children: source[side][line - 1] ?? [{ type: 'text', value: change.content }]
                }
                result[side][line - 1] = [token]
            }
            if (change.type !== 'insert')
                wrap('old', change.type === 'normal' ? change.oldLineNumber : change.lineNumber)
            if (change.type !== 'delete')
                wrap('new', change.type === 'normal' ? change.newLineNumber : change.lineNumber)
        }
    }
    return result
}

/** Copy source cells only, restoring visually cropped whitespace for whole-line selections. */
export function selectedSource(range: Range, root: HTMLElement): string | undefined {
    const lines = [...root.querySelectorAll<HTMLElement>('.ws-diff-source-line')].filter((line) =>
        range.intersectsNode(line)
    )
    const selected: string[] = []
    for (const line of lines) {
        const contents = document.createRange()
        contents.selectNodeContents(line)
        if (range.compareBoundaryPoints(Range.START_TO_START, contents) > 0)
            contents.setStart(range.startContainer, range.startOffset)
        if (range.compareBoundaryPoints(Range.END_TO_END, contents) < 0)
            contents.setEnd(range.endContainer, range.endOffset)
        if (
            contents.collapsed &&
            (line.textContent ||
                range.compareBoundaryPoints(Range.START_TO_START, contents) > 0 ||
                range.compareBoundaryPoints(Range.END_TO_END, contents) < 0)
        )
            continue
        const before = document.createRange()
        before.selectNodeContents(line)
        before.setEnd(contents.startContainer, contents.startOffset)
        const start = before.toString().length
        const indent = Number(line.dataset.indentCharacters ?? 0)
        selected.push((start <= indent ? (line.textContent ?? '').slice(0, start) : '') + contents.toString())
    }
    return selected.length ? selected.join('\n') : undefined
}
