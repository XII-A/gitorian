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
export function selectedDiffLines(file: FileDiffMetadata, selection: SelectedLineRange, split = false): string {
    const side = selection.side ?? 'additions'
    const endSide = selection.endSide ?? side
    if (endSide !== side) return selectedCrossSideLines(file, selection, side, endSide, split)
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

/** Mixed-side selections copy display rows, left before right, with context once and no patch markers. */
function selectedCrossSideLines(
    file: FileDiffMetadata,
    selection: SelectedLineRange,
    side: 'additions' | 'deletions',
    endSide: 'additions' | 'deletions',
    split: boolean
): string {
    const rows: string[] = []
    let first: number | undefined, last: number | undefined
    for (const hunk of file.hunks) {
        for (const content of hunk.hunkContent) {
            const append = (deletion: number | undefined, addition: number | undefined) => {
                const coordinates = {
                    deletions:
                        deletion === undefined ? undefined : hunk.deletionStart + deletion - hunk.deletionLineIndex,
                    additions:
                        addition === undefined ? undefined : hunk.additionStart + addition - hunk.additionLineIndex
                }
                if (coordinates[side] === selection.start) first = rows.length
                if (coordinates[endSide] === selection.end) last = rows.length
                const text: string[] = []
                if (deletion !== undefined) text.push(file.deletionLines[deletion].replace(/\r?\n$/, ''))
                if (addition !== undefined && (deletion === undefined || content.type !== 'context'))
                    text.push(file.additionLines[addition].replace(/\r?\n$/, ''))
                rows.push(text.join('\n'))
            }
            if (content.type === 'context') {
                for (let i = 0; i < content.lines; i++)
                    append(content.deletionLineIndex + i, content.additionLineIndex + i)
            } else if (split) {
                for (let i = 0; i < Math.max(content.deletions, content.additions); i++)
                    append(
                        i < content.deletions ? content.deletionLineIndex + i : undefined,
                        i < content.additions ? content.additionLineIndex + i : undefined
                    )
            } else {
                for (let i = 0; i < content.deletions; i++) append(content.deletionLineIndex + i, undefined)
                for (let i = 0; i < content.additions; i++) append(undefined, content.additionLineIndex + i)
            }
        }
    }
    return first === undefined || last === undefined
        ? ''
        : rows.slice(Math.min(first, last), Math.max(first, last) + 1).join('\n')
}
