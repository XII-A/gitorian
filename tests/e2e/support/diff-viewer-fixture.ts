import { initialState, type Activity } from '../../../src/shared/model'

export function fixturePatch(path: string, lines: number) {
    const before = Array.from({ length: lines }, (_, index) => `    const value${index} = "before ${index}";`)
    const after = before.map((line) => line.replace('before', 'after'))
    return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${lines} +1,${lines} @@\n${before.map((line) => '-' + line).join('\n')}\n${after.map((line) => '+' + line).join('\n')}\n`
}
export const ordinary = fixturePatch('view.ts', 120)
export const copyPatch =
    'diff --git a/copy.ts b/copy.ts\n--- a/copy.ts\n+++ b/copy.ts\n@@ -10,4 +20,5 @@\n-    old\n+    new\n \n     tail\n+    extra\n     end\n'
export const large = fixturePatch('large.ts', 10000)
const longLine = `    const minified = "${'abcdefghij'.repeat(3000)}";`
export const long = `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -1 +1 @@\n-${longLine}\n+${longLine.replace('minified', 'changed')}\n`
export const state = initialState()
state.settings.refreshMinutes = 0
state.repositories = [
    {
        id: 'fixture',
        name: 'diff-fixtures',
        path: '',
        remote: '',
        base: 'main',
        trackingStart: '2026-01-01',
        emails: [],
        available: false,
        removed: false,
        branchBases: {},
        branches: ['main']
    }
]
const activity: Activity = {
    id: 'diff-fixture',
    title: 'Review highlighted changes',
    description: '```ts\nconst source = "<raw>";\n```',
    kind: 'change-request',
    repositoryId: 'fixture',
    date: new Date().toISOString(),
    author: 'fixture-author',
    branches: ['main'],
    files: [
        { name: 'view.ts', status: 'modified', lineStats: { additions: 120, deletions: 120 } },
        { name: 'copy.ts', status: 'modified', lineStats: { additions: 2, deletions: 1 } },
        { name: 'large.ts', status: 'modified', lineStats: { additions: 10000, deletions: 10000 } },
        { name: 'long.ts', status: 'modified', lineStats: { additions: 1, deletions: 1 } }
    ],
    filesLoaded: true,
    revision: 'fixture-revision',
    diffRevision: 'fixture-revision',
    disposition: 'inbox',
    explicit: false,
    deletedBranches: [],
    changeRequest: { status: 'open', openedAt: new Date().toISOString(), commitDates: [] }
}
state.activities = [activity]
state.diffs[activity.id] = ordinary + copyPatch + large + long
state.revisions = [
    {
        id: 'fixture-revision',
        activityId: activity.id,
        base: 'base',
        head: 'head',
        diff: ordinary + copyPatch + large + long
    }
]
