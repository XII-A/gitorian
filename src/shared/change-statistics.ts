import type { Activity } from './model'

export interface LineStats {
    additions: number
    deletions: number
}
export type ChangeCategory = 'Runtime' | 'Tests' | 'Evals' | 'Docs' | 'Other'
export function diffLineStats(file: {
    isBinary?: boolean
    hunks: { changes: { type: string }[] }[]
}): LineStats | null {
    if (file.isBinary) return null
    const stats = { additions: 0, deletions: 0 }
    for (const hunk of file.hunks)
        for (const change of hunk.changes) {
            if (change.type === 'insert') stats.additions++
            if (change.type === 'delete') stats.deletions++
        }
    return stats
}
const categories: ChangeCategory[] = ['Runtime', 'Tests', 'Evals', 'Docs', 'Other']

/** Path conventions partition files once. Rename destinations describe the resulting work. */
function categoryFor(name: string): ChangeCategory {
    const path = name.toLowerCase()
    if (/(^|\/)(evals?|__evals__|evaluations?|benchmarks?)(\/|$)|[.-](eval|bench)\./.test(path)) return 'Evals'
    if (/(^|\/)(__tests__|tests?|specs?|e2e|fixtures?)(\/|$)|[.-](test|spec)\./.test(path)) return 'Tests'
    if (/(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|adoc)$/.test(path)) return 'Docs'
    if (
        /(^|\/)(src|lib|app|apps|packages)(\/|$)|\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|cs|rb|php|vue|svelte|css|scss|html|sql|sh)$/.test(
            path
        )
    )
        return 'Runtime'
    return 'Other'
}

/** Missing counts are unknown, null is binary, and an empty file list is a confirmed zero. */
export function summarizeChanges(files: Activity['files']) {
    const groups = categories.map((category) => ({ category, additions: 0, deletions: 0, files: 0 }))
    const total: LineStats = { additions: 0, deletions: 0 }
    let binaryFiles = 0
    let unknownFiles = 0
    for (const file of files) {
        if (file.lineStats === undefined) {
            unknownFiles++
            continue
        }
        if (file.lineStats === null) {
            binaryFiles++
            continue
        }
        const group = groups.find((group) => group.category === categoryFor(file.name))!
        group.files++
        group.additions += file.lineStats.additions
        group.deletions += file.lineStats.deletions
        total.additions += file.lineStats.additions
        total.deletions += file.lineStats.deletions
    }
    return {
        total: unknownFiles ? undefined : total,
        groups: groups.filter((group) => group.files),
        binaryFiles,
        unknownFiles
    }
}

export function hasFileStatistics(activity: Activity): boolean {
    return !!activity.filesLoaded && activity.files.every((file) => file.lineStats !== undefined)
}
