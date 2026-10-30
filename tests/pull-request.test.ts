import { transportClient, githubClient, run } from './effect-fixtures'
import { describe, expect, it } from 'vitest'
import { activitySchema } from '../src/shared/model'
import { changeRequestContext } from '../src/renderer/pull-request'
import { sampleState } from './workspace-fixture'
const repository = { ...sampleState('2026-10-05').repositories[0], remote: 'https://github.com/example/project' }
describe('pull request status acquisition', () => {
    it.each([
        ['open', false, null, 'open'],
        ['open', true, null, 'draft'],
        ['closed', true, null, 'closed'],
        ['closed', false, '2026-10-09T10:00:00Z', 'merged']
    ] as const)('captures %s / draft %s / merged %s as %s', async (state, draft, mergedAt, expected) => {
        const pull = {
            number: 42,
            title: 'Keep uploads safe',
            body: 'Summary',
            html_url: 'https://github.com/example/project/pull/42',
            state,
            draft,
            created_at: '2026-10-05T10:00:00Z',
            updated_at: '2026-10-09T10:00:00Z',
            closed_at: state === 'closed' ? '2026-10-09T10:00:00Z' : null,
            merged_at: mergedAt,
            merge_commit_sha: mergedAt ? 'merged-sha' : null,
            user: { login: 'me' },
            base: { ref: 'main', sha: 'base-sha' },
            head: { ref: 'feature/work', sha: 'head-sha' }
        }
        const dates = ['2026-10-02T10:00:00Z', '2026-10-06T10:00:00Z', '2026-10-08T10:00:00Z']
        const http = await transportClient((input) => {
            const url = input instanceof Request ? input.url : String(input)
            const result = url.includes('/pulls?')
                ? [pull]
                : url.includes('/commits?')
                  ? dates.map((date, index) => ({
                        sha: `commit-${index}`,
                        commit: { author: { email: 'other@example.com', date }, message: 'Change' }
                    }))
                  : []
            return Promise.resolve(new Response(JSON.stringify(result)))
        })
        const github = await githubClient(http, () => 'test')
        const activities = await run(github.activities(repository, 'me', []))
        const canonical = activities.find((item) => item.kind === 'change-request')!
        expect(activitySchema.parse(canonical).changeRequest).toEqual({
            status: expected,
            openedAt: pull.created_at,
            commitDates: dates.slice(1),
            closedAt: pull.closed_at ?? undefined,
            mergedAt: mergedAt ?? undefined
        })
        expect(activities.filter((item) => item.kind !== 'change-request').every((item) => !item.changeRequest)).toBe(
            true
        )
    })
    it('refreshes status-only changes even when GitHub timestamps and commit hashes are unchanged', async () => {
        let draft = true
        const pull = {
            number: 42,
            title: 'Work',
            body: '',
            html_url: '',
            state: 'open',
            created_at: '2026-10-05T10:00:00Z',
            updated_at: '2026-10-05T10:00:00Z',
            merged_at: null,
            merge_commit_sha: null,
            user: { login: 'me' },
            base: { ref: 'main', sha: 'base' },
            head: { ref: 'feature', sha: 'head' }
        }
        const github = await githubClient(
            await transportClient((input) => {
                const url = input instanceof Request ? input.url : String(input)
                return Promise.resolve(
                    new Response(JSON.stringify(url.includes('/pulls?') ? [{ ...pull, draft }] : []))
                )
            }),
            () => 'test'
        )
        const versions: Record<string, string> = {}
        expect((await run(github.activities(repository, 'me', [], { versions })))[0].changeRequest?.status).toBe(
            'draft'
        )
        draft = false
        expect((await run(github.activities(repository, 'me', [], { versions })))[0].changeRequest?.status).toBe('open')
        expect(await run(github.activities(repository, 'me', [], { versions }))).toEqual([])
    })
})
describe('legacy PR context', () => {
    it('does not infer open status from the absence of a merged event', () => {
        const activity = { ...sampleState('2026-10-05').activities[8], kind: 'change-request' as const }
        expect(changeRequestContext(activity, [activity]).status).toBeUndefined()
        expect(activitySchema.parse(activity).changeRequest).toBeUndefined()
    })
    it('reads known opened and merged dates without including reviews or another repository', () => {
        const activity = { ...sampleState('2026-10-05').activities[8], kind: 'change-request' as const }
        const opened = {
            ...activity,
            id: `${activity.id}:opened`,
            kind: 'opened' as const,
            date: '2026-10-05T10:00:00Z'
        }
        const merged = {
            ...activity,
            id: `${activity.id}:merged`,
            kind: 'merged' as const,
            date: '2026-10-09T10:00:00Z'
        }
        const context = changeRequestContext(activity, [
            activity,
            opened,
            merged,
            { ...opened, repositoryId: 'another-repository', date: '2020-01-01T00:00:00Z' },
            { ...activity, kind: 'review', date: '2026-10-11T10:00:00Z' }
        ])
        expect(context).toMatchObject({ status: 'merged', openedAt: opened.date, mergedAt: merged.date })
        expect(context.dates).not.toContain('2020-01-01T00:00:00Z')
        expect(context.dates).not.toContain('2026-10-11T10:00:00Z')
    })
})
