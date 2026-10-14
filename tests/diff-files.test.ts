import { describe, expect, it } from 'vitest'

import { filesFromDiff } from '../src/main/diff-files'
import { required } from '../src/shared/required'
import { patch, workspace } from './fixtures'

describe('diff-files', () => {
    it('derives changed-file names and statuses from text and metadata patches', () => {
        const files = filesFromDiff(
            `${
                patch
            }diff --git a/new.bin b/new.bin\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/new.bin differ\n` +
                `diff --git a/deleted.ts b/deleted.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n` +
                `diff --git a/old.ts b/renamed.ts\nsimilarity index 100%\nrename from old.ts\nrename to renamed.ts\n` +
                `diff --git a/source.ts b/copied.ts\nsimilarity index 100%\ncopy from source.ts\ncopy to copied.ts\n` +
                `diff --git a/mode.sh b/mode.sh\nold mode 100644\nnew mode 100755\n`
        )
        expect(files).toStrictEqual([
            { name: 'a.ts', status: 'modified' },
            { name: 'new.bin', status: 'added' },
            { name: 'deleted.ts', status: 'removed' },
            { name: 'renamed.ts', previousName: 'old.ts', status: 'renamed' },
            { name: 'copied.ts', previousName: 'source.ts', status: 'copied' },
            { name: 'mode.sh', status: 'modified' }
        ])
    })

    it('uses metadata fallback for unavailable or ambiguous patch paths', () => {
        expect([
            filesFromDiff('GitHub could not provide this diff (HTTP 406).') === undefined,
            filesFromDiff('diff --git "a/a\\t.ts" "b/a\\t.ts"\n') === undefined,
            filesFromDiff('diff --git a/a file.ts b/a file.ts\n') === undefined,
            filesFromDiff('')
        ]).toStrictEqual([true, true, true, []])
    })

    it('opens a PR diff without file-list requests and reuses its files in hub details', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.repository.trackingStart = '2026-10-05'
            await app.service.refresh({ source: 'github' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            const start = app.remote.requests.length
            const reply = await app.service.handle({ activityId: pr.id, type: 'details' })
            expect([
                Object.is(reply.diff, patch),
                pr.files,
                Boolean(pr.filesLoaded),
                Boolean(app.remote.requests.slice(start).some((request) => request.url.includes('/files')))
            ]).toStrictEqual([true, [{ name: 'a.ts', status: 'modified' }], true, false])
            const loaded = app.remote.requests.length
            await app.service.handle({ activityId: pr.id, content: 'files', type: 'details' })
            await app.service.handle({ activityId: pr.id, type: 'details' })
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
            await app.service.refresh({ source: 'github' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            app.remote.failDiff = true
            const start = app.remote.requests.length
            await app.service.handle({ activityId: pr.id, content: 'files', type: 'details' })
            expect([
                pr.files,
                app.store.state.diffs[pr.id] === undefined,
                app.remote.requests.slice(start).map((request) => request.url)
            ]).toStrictEqual([[{ name: 'a.ts', status: 'modified' }], true, [expect.stringContaining('/files?')]])
        } finally {
            await app.close()
        }
    })
})
