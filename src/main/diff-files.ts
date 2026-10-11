import parser from 'gitdiff-parser'
import type { Activity } from '../shared/model'

/** Undefined means the patch cannot safely supply the file list. */
export function filesFromDiff(diff: string): Activity['files'] | undefined {
    if (diff === '') return []
    if (!diff.startsWith('diff --git ')) return undefined
    const headers = diff.split('\n').filter((line) => line.startsWith('diff --git '))
    // This parser does not reliably decode Git's quoted/escaped paths. Keep
    // the metadata endpoint for those paths rather than returning wrong names.
    if (headers.some((line) => !/^diff --git a\/\S+ b\/\S+$/.test(line))) return undefined
    try {
        const files = parser.parse(diff)
        if (files.length !== headers.length) return undefined
        const statuses = { add: 'added', delete: 'removed', modify: 'modified', rename: 'renamed', copy: 'copied' }
        return files.map((file) => {
            // Binary and empty files may have no ---/+++ markers, so their
            // creation/deletion is expressed only through the mode headers.
            const status =
                file.type === 'modify' && file.newMode && !file.oldMode
                    ? 'added'
                    : file.type === 'modify' && file.oldMode && !file.newMode
                      ? 'removed'
                      : statuses[file.type]
            return {
                name: status === 'removed' ? file.oldPath : file.newPath,
                status,
                ...(status === 'renamed' || status === 'copied' ? { previousName: file.oldPath } : {})
            }
        })
    } catch {
        return undefined
    }
}
