import { run } from './effect-fixtures'
import { expect, it } from 'vitest'
import { filesFromDiff } from '../src/main/diff-files'
import { patch, workspace } from './fixtures'
it('derives changed-file names and statuses from text and metadata patches', () => {
    const files = filesFromDiff(
        patch +
            'diff --git a/new.bin b/new.bin\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/new.bin differ\n' +
            'diff --git a/deleted.ts b/deleted.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n' +
            'diff --git a/old.ts b/renamed.ts\nsimilarity index 100%\nrename from old.ts\nrename to renamed.ts\n' +
            'diff --git a/source.ts b/copied.ts\nsimilarity index 100%\ncopy from source.ts\ncopy to copied.ts\n' +
            'diff --git a/mode.sh b/mode.sh\nold mode 100644\nnew mode 100755\n'
    )
    expect(files).toEqual([
        { name: 'a.ts', status: 'modified', lineStats: { additions: 1, deletions: 1 } },
        { name: 'new.bin', status: 'added', lineStats: null },
        { name: 'deleted.ts', status: 'removed', lineStats: { additions: 0, deletions: 1 } },
        { name: 'renamed.ts', status: 'renamed', previousName: 'old.ts', lineStats: { additions: 0, deletions: 0 } },
        { name: 'copied.ts', status: 'copied', previousName: 'source.ts', lineStats: { additions: 0, deletions: 0 } },
        { name: 'mode.sh', status: 'modified', lineStats: { additions: 0, deletions: 0 } }
    ])
})
it('uses metadata fallback for unavailable or ambiguous patch paths', () => {
    expect(filesFromDiff('GitHub could not provide this diff (HTTP 406).')).toBeUndefined()
    expect(filesFromDiff('diff --git "a/a\\t.ts" "b/a\\t.ts"\n')).toBeUndefined()
    expect(filesFromDiff('diff --git a/a file.ts b/a file.ts\n')).toBeUndefined()
    expect(filesFromDiff('')).toEqual([])
})
it('opens a PR diff without file-list requests and reuses its files in hub details', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        app.repository.trackingStart = '2026-10-05'
        await run(app.service.refresh({ source: 'github' }))
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        const start = app.remote.requests.length
        const reply = await run(app.service.handle({ type: 'details', activityId: pr.id }))
        expect(reply.diff).toBe(patch)
        expect(pr.files).toEqual([{ name: 'a.ts', status: 'modified', lineStats: { additions: 1, deletions: 1 } }])
        expect(pr.filesLoaded).toBe(true)
        expect(app.remote.requests.slice(start).some((request) => request.url.includes('/files'))).toBe(false)
        const loaded = app.remote.requests.length
        await run(app.service.handle({ type: 'details', activityId: pr.id, content: 'files' }))
        await run(app.service.handle({ type: 'details', activityId: pr.id }))
        expect(app.remote.requests).toHaveLength(loaded)
    } finally {
        await app.close()
    }
})
it('keeps metadata-only PR details independent of patch download', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        app.repository.trackingStart = '2026-10-05'
        await run(app.service.refresh({ source: 'github' }))
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        app.remote.failDiff = true
        const start = app.remote.requests.length
        await run(app.service.handle({ type: 'details', activityId: pr.id, content: 'files' }))
        expect(pr.files).toEqual([{ name: 'a.ts', status: 'modified' }])
        expect(app.store.state.diffs[pr.id]).toBeUndefined()
        expect(app.remote.requests.slice(start).map((request) => request.url)).toEqual([
            expect.stringContaining('/files?')
        ])
    } finally {
        await app.close()
    }
})
