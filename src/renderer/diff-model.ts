import { getFiletypeFromFileName, parsePatchFiles, type FileDiffMetadata, type SelectedLineRange } from '@pierre/diffs'
import { codeLexer, codeLimits } from './code-highlighting'
import type { LineStats } from '../shared/change-statistics'

export interface DiffFile extends FileDiffMetadata {
    raw: string
    binary: boolean
}

export function parsePatch(text: string): DiffFile[] {
    if (text.length > codeLimits.patch) return []
    try {
        const sections = text.split(/(?=^diff --git )/m).filter(Boolean)
        return parsePatchFiles(text, { disableLineMatching: true, throwOnError: true })
            .flatMap((patch) => patch.files)
            .map((file, index) => ({
                ...file,
                lang: codeLexer(getFiletypeFromFileName(file.name)) ?? 'text',
                raw: sections[index] ?? text,
                binary: /^(Binary files .* differ|GIT binary patch)\r?$/m.test(sections[index] ?? '')
            }))
    } catch {
        return []
    }
}

export function diffStats(file: DiffFile): LineStats | null {
    return file.binary
        ? null
        : file.hunks.reduce(
              (stats, hunk) => ({
                  additions: stats.additions + hunk.additionLines,
                  deletions: stats.deletions + hunk.deletionLines
              }),
              { additions: 0, deletions: 0 }
          )
}

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

export function compactDiffIndents(file: FileDiffMetadata) {
    return file.hunks.map((hunk) => {
        const prefix = sharedIndent([
            ...file.additionLines.slice(hunk.additionLineIndex, hunk.additionLineIndex + hunk.additionCount),
            ...file.deletionLines.slice(hunk.deletionLineIndex, hunk.deletionLineIndex + hunk.deletionCount)
        ])
        return {
            start: hunk.unifiedLineStart,
            end: hunk.unifiedLineStart + hunk.unifiedLineCount,
            characters: prefix.length,
            columns: indentColumns(prefix)
        }
    })
}

/** Public line-range selection uses source coordinates, including unmounted lines. */
export function selectedDiffLines(file: FileDiffMetadata, selection: SelectedLineRange): string {
    const side = selection.side ?? 'additions'
    const first = Math.min(selection.start, selection.end),
        last = Math.max(selection.start, selection.end)
    const lines = side === 'deletions' ? file.deletionLines : file.additionLines
    const result: string[] = []
    for (const hunk of file.hunks) {
        const start = side === 'deletions' ? hunk.deletionStart : hunk.additionStart
        const count = side === 'deletions' ? hunk.deletionCount : hunk.additionCount
        const index = side === 'deletions' ? hunk.deletionLineIndex : hunk.additionLineIndex
        for (let line = Math.max(first, start); line <= Math.min(last, start + count - 1); line++)
            result.push(lines[index + line - start].replace(/\r?\n$/, ''))
    }
    return result.join('\n')
}
