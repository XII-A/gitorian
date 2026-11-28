import { changeCategories, type Activity, type WeeklyChangeSummary } from './model'

export interface LineStats {
    additions: number
    deletions: number
}
export type ChangeCategory = (typeof changeCategories)[number]
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

/** Path conventions partition files once. Rename destinations describe the resulting work. */
export function changeCategoryFor(name: string): ChangeCategory {
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
    const groups = changeCategories.map((category) => ({ category, additions: 0, deletions: 0, files: 0 }))
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
        const group = groups.find((group) => group.category === changeCategoryFor(file.name))!
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

export function hasFileStatistics(activity: Pick<Activity, 'filesLoaded' | 'files'>): boolean {
    return !!activity.filesLoaded && activity.files.every((file) => file.lineStats !== undefined)
}

const lockfiles = new Set([
    'pnpm-lock.yaml',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'Cargo.lock',
    'poetry.lock',
    'uv.lock',
    'Pipfile.lock',
    'Gemfile.lock',
    'composer.lock',
    'go.sum',
    'flake.lock',
    'Podfile.lock',
    'Package.resolved',
    'pubspec.lock',
    'mix.lock',
    'gradle.lockfile',
    'packages.lock.json'
])

export function isExcludedFromWeeklyLineStats(path: string): boolean {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return (
        lockfiles.has(name) ||
        /(?:^|\/)(?:__generated__|generated|vendor|third_party|third-party)\//i.test(path) ||
        /(?:^|\/)drizzle\/meta\/[^/]*\.json$/i.test(path) ||
        /(?:_snapshot\.json|ModelSnapshot\.cs|\.Designer\.cs|\.g\.(?:ts|dart)|\.freezed\.dart|\.pb\.(?:go|ts|cc|h)|_pb\.js|_pb2\.py|\.tsbuildinfo|\.snap(?:\.new)?|\.min\.(?:js|css)|\.map|\.svg)$/i.test(
            name
        ) ||
        /\.(?:generated|gen)\./i.test(name) ||
        /^(?:auto-imports\.d\.ts|components\.d\.ts|THIRD-PARTY-LICENSES\.txt)$/i.test(name)
    )
}

export function emptyWeeklySummary(): WeeklyChangeSummary {
    return { categories: {}, excludedFiles: 0, excludedAdditions: 0, excludedDeletions: 0, binaryFiles: 0 }
}

export function addWeeklyFile(
    summary: WeeklyChangeSummary,
    name: string,
    stats: LineStats | null,
    attributeExcluded = false
) {
    if (stats === null) {
        summary.binaryFiles++
    } else if (attributeExcluded || isExcludedFromWeeklyLineStats(name)) {
        summary.excludedFiles++
        summary.excludedAdditions += stats.additions
        summary.excludedDeletions += stats.deletions
    } else {
        const category = changeCategoryFor(name)
        const group = (summary.categories[category] ??= { files: 0, additions: 0, deletions: 0 })
        group.files++
        group.additions += stats.additions
        group.deletions += stats.deletions
    }
}

export function weeklyLineStats(
    activities: Pick<Activity, 'kind' | 'files' | 'filesLoaded' | 'weeklyChangeSummary'>[]
) {
    const summary = emptyWeeklySummary()
    let missing = 0,
        commits = 0
    for (const activity of activities) {
        if (activity.kind !== 'commit') continue
        commits++
        const stored = activity.weeklyChangeSummary
        if (!stored) {
            if (hasFileStatistics(activity))
                for (const file of activity.files) addWeeklyFile(summary, file.name, file.lineStats!)
            else missing++
            continue
        }
        for (const category of changeCategories) {
            const counts = stored.categories[category]
            if (!counts) continue
            const group = (summary.categories[category] ??= { files: 0, additions: 0, deletions: 0 })
            group.files += counts.files
            group.additions += counts.additions
            group.deletions += counts.deletions
        }
        summary.binaryFiles += stored.binaryFiles
        summary.excludedFiles += stored.excludedFiles
        summary.excludedAdditions += stored.excludedAdditions
        summary.excludedDeletions += stored.excludedDeletions
    }
    const groups = changeCategories.map((category) => ({
        category,
        ...(summary.categories[category] ?? { files: 0, additions: 0, deletions: 0 })
    }))
    const total =
        commits && missing === commits
            ? undefined
            : groups.reduce(
                  (sum, g) => ({
                      additions: sum.additions + g.additions,
                      deletions: sum.deletions + g.deletions
                  }),
                  { additions: 0, deletions: 0 }
              )
    return { ...summary, groups, total, missing, commits }
}
