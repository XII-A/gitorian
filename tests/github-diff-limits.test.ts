import { run, transportClient } from './effect-fixtures'
import { expect, it } from 'vitest'
import { workspace } from './fixtures'
import { HttpError } from '../src/main/http'
it('finishes remote acquisition when GitHub refuses an old PR diff with 406', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        app.repository.trackingStart = '2026-10-05'
        app.remote.authorDate = '2026-09-29T10:00:00Z'
        app.remote.diffStatus = 406
        await run(app.service.refresh({ source: 'github' }))
        const status = app.store.state.acquisition?.[`github:${app.repository.id}`]
        expect(status?.error).toBeUndefined()
        expect(status?.lastSuccess).toBeDefined()
        expect(status?.windowEnd).toBeUndefined()
        expect(status?.versions?.['1']).toBeDefined()
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        expect(pr.revision).toBeDefined()
        expect(pr.fingerprint).toBeUndefined()
        const details = await run(app.service.handle({ type: 'details', activityId: pr.id }))
        expect(details.diff).toContain('GitHub')
        expect(details.diff).toContain('406')
        expect(pr.files[0].name).toBe('a.ts')
        const start = app.remote.requests.length
        await run(app.service.refresh({ source: 'github' }))
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
        await run(app.service.refresh({ source: 'github' }))
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        await run(app.service.handle({ type: 'details', activityId: pr.id }))
        const previous = pr.revision
        expect(pr.fingerprint).toBeDefined()
        app.remote.head = 'e'.repeat(40)
        app.remote.diffStatus = 406
        await run(app.service.refresh({ source: 'github' }))
        expect(app.store.state.acquisition?.[`github:${app.repository.id}`].error).toBeUndefined()
        expect(pr.revision).not.toBe(previous)
        expect(pr.fingerprint).toBeUndefined()
        expect(app.store.state.diffs[pr.id]).toContain('406')
    } finally {
        await app.close()
    }
})
it('continues to reject a 406 on JSON metadata rather than masking a source failure', async () => {
    const http = await transportClient(() =>
        Promise.resolve(new Response('{}', { status: 406, statusText: 'Not Acceptable' }))
    )
    await expect(
        run(http.request('https://api.github.com/repos/example/project/pulls/1', 'test'))
    ).rejects.toBeInstanceOf(HttpError)
})
