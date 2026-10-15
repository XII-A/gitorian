import type { FileData, HunkTokens, TokenNode } from 'react-diff-view'
import { tokenize } from 'react-diff-view'

/** Use the same prefix for both sides, so indentation-only changes remain visible. */
export const sharedIndent = (lines: string[]): string => {
    const prefixes = lines.filter((line) => line.trim()).map((line) => /^[\t ]*/u.exec(line)?.[0] ?? '')
    let prefix = prefixes[0] ?? ''
    for (const next of prefixes) {
        let length = 0
        while (length < prefix.length && prefix[length] === next[length]) {
            length += 1
        }
        prefix = prefix.slice(0, length)
    }
    return prefix
}

export const indentColumns = (prefix: string): number => {
    let column = 0
    for (const character of prefix) {
        column += character === '\t' ? 4 - (column % 4) : 1
    }
    return column
}

/** Wrap original tokens without changing source text, line numbers, or highlighting. */
export const presentationTokens = (
    file: FileData,
    highlighted: HunkTokens | undefined,
    compact: boolean
): HunkTokens => {
    const source = highlighted ?? tokenize(file.hunks)
    const result = { new: [...source.new], old: [...source.old] }
    for (const hunk of file.hunks) {
        const prefix = compact ? sharedIndent(hunk.changes.map((change) => change.content)) : ''
        for (const change of hunk.changes) {
            const wrap = (side: 'old' | 'new', line: number) => {
                const removed = change.content.startsWith(prefix) ? prefix : ''
                const token: TokenNode = {
                    children: source[side][line - 1] ?? [{ type: 'text', value: change.content }],
                    indentCharacters: removed.length,
                    indentColumns: indentColumns(removed),
                    type: 'source-line'
                }
                result[side][line - 1] = [token]
            }
            if (change.type !== 'insert') {
                wrap('old', change.type === 'normal' ? change.oldLineNumber : change.lineNumber)
            }
            if (change.type !== 'delete') {
                wrap('new', change.type === 'normal' ? change.newLineNumber : change.lineNumber)
            }
        }
    }
    return result
}

/** Copy source cells only, restoring visually cropped whitespace for whole-line selections. */
export const selectedSource = (range: Range, root: HTMLElement): string | undefined => {
    const lines = [...root.querySelectorAll<HTMLElement>('.ws-diff-source-line')].filter((line) =>
        range.intersectsNode(line)
    )
    const selected: string[] = []
    for (const line of lines) {
        const contents = document.createRange()
        contents.selectNodeContents(line)
        if (range.compareBoundaryPoints(Range.START_TO_START, contents) > 0) {
            contents.setStart(range.startContainer, range.startOffset)
        }
        if (range.compareBoundaryPoints(Range.END_TO_END, contents) < 0) {
            contents.setEnd(range.endContainer, range.endOffset)
        }
        if (
            contents.collapsed &&
            (line.textContent ||
                range.compareBoundaryPoints(Range.START_TO_START, contents) > 0 ||
                range.compareBoundaryPoints(Range.END_TO_END, contents) < 0)
        ) {
            continue
        }
        const before = document.createRange()
        before.selectNodeContents(line)
        before.setEnd(contents.startContainer, contents.startOffset)
        const start = before.toString().length
        const indent = Number(line.dataset.indentCharacters ?? 0)
        selected.push((start <= indent ? (line.textContent ?? '').slice(0, start) : '') + contents.toString())
    }
    return selected.length ? selected.join('\n') : undefined
}
