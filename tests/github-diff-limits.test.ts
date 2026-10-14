import { describe, expect, it } from 'vitest'

import { Http, HttpError } from '../src/main/http'
import { required } from '../src/shared/required'
import { workspace } from './fixtures'

describe('github-diff-limits', () => {
    it('finishes remote acquisition when GitHub refuses an old PR diff with 406', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.repository.trackingStart = '2026-10-05'
            app.remote.authorDate = '2026-09-29T10:00:00Z'
            app.remote.diffStatus = 406
            await app.service.refresh({ source: 'github' })
            const status = app.store.state.acquisition?.[`github:${app.repository.id}`]
            expect([
                status?.error === undefined,
                status?.lastSuccess !== undefined,
                status?.windowEnd === undefined,
                status?.versions?.['1'] !== undefined
            ]).toStrictEqual([true, true, true, true])
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            expect([pr.revision !== undefined, pr.fingerprint === undefined]).toStrictEqual([true, true])
            const details = await app.service.handle({ activityId: pr.id, type: 'details' })
            expect([
                details.diff?.includes('GitHub'),
                details.diff?.includes('406'),
                Object.is(pr.files[0].name, 'a.ts')
            ]).toStrictEqual([true, true, true])
            const start = app.remote.requests.length
            await app.service.refresh({ source: 'github' })
            expect(app.remote.requests.slice(start)).toHaveLength(1)
        } finally {
            await app.close()
        }
    })

    it('does not reuse an old comparison fingerprint when a changed PR diff returns 406', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.repository.trackingStart = '2026-10-05'
            await app.service.refresh({ source: 'github' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            await app.service.handle({ activityId: pr.id, type: 'details' })
            const previous = pr.revision
            expect(pr.fingerprint).toBeDefined()
            app.remote.head = 'e'.repeat(40)
            app.remote.diffStatus = 406
            await app.service.refresh({ source: 'github' })
            expect([
                app.store.state.acquisition?.[`github:${app.repository.id}`].error === undefined,
                Object.is(pr.revision, previous),
                pr.fingerprint === undefined,
                app.store.state.diffs[pr.id]?.includes('406')
            ]).toStrictEqual([true, false, true, true])
        } finally {
            await app.close()
        }
    })

    it('continues to reject a 406 on JSON metadata rather than masking a source failure', async () => {
        const http = new Http(() => Promise.resolve(new Response('{}', { status: 406, statusText: 'Not Acceptable' })))
        await expect(
            http.request('https://api.github.com/repos/example/project/pulls/1', 'test')
        ).rejects.toBeInstanceOf(HttpError)
    })
})
