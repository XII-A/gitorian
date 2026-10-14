import { describe, expect, it, vi } from 'vitest'

import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'
import { pullRequestContext } from '../src/renderer/pull-request'
import { sampleState } from '../src/renderer/workspace-sample'
import { activitySchema } from '../src/shared/model'
import { required } from '../src/shared/required'

const repository = { ...sampleState('2026-10-05').repositories[0], remote: 'https://github.com/example/project' }

describe('pull request status acquisition', () => {
    it.each([
        ['open', false, null, 'open'],
        ['open', true, null, 'draft'],
        ['closed', true, null, 'closed'],
        ['closed', false, '2026-10-09T10:00:00Z', 'merged']
    ] as const)('captures %s / draft %s / merged %s as %s', async (state, draft, mergedAt, expected) => {
        const pull = {
            base: { ref: 'main', sha: 'base-sha' },
            body: 'Summary',
            closed_at: state === 'closed' ? '2026-10-09T10:00:00Z' : null,
            created_at: '2026-10-05T10:00:00Z',
            draft,
            head: { ref: 'feature/work', sha: 'head-sha' },
            html_url: 'https://github.com/example/project/pull/42',
            merge_commit_sha: mergedAt ? 'merged-sha' : null,
            merged_at: mergedAt,
            number: 42,
            state,
            title: 'Keep uploads safe',
            updated_at: '2026-10-09T10:00:00Z',
            user: { login: 'me' }
        }
        const dates = ['2026-10-02T10:00:00Z', '2026-10-06T10:00:00Z', '2026-10-08T10:00:00Z']
        const http = new Http((input) => {
            const url = input instanceof Request ? input.url : String(input)
            const result = (() => {
                if (url.includes('/pulls?')) {
                    return [pull]
                }
                if (url.includes('/commits?')) {
                    return dates.map((date, index) => ({
                        commit: { author: { date, email: 'other@example.com' }, message: 'Change' },
                        sha: `commit-${index}`
                    }))
                }
                return []
            })()
            return Promise.resolve(Response.json(result))
        })
        const github = new GitHub(http, () => 'test', vi.fn<(...args: unknown[]) => void>())
        const activities = await github.activities(repository, 'me', [])
        const canonical = required(activities.find((item) => item.kind === 'pr'))
        expect([
            activitySchema.parse(canonical).pullRequest,
            Boolean(activities.filter((item) => item.kind !== 'pr').every((item) => !item.pullRequest))
        ]).toStrictEqual([
            {
                closedAt: pull.closed_at ?? undefined,
                commitDates: dates.slice(1),
                mergedAt: mergedAt ?? undefined,
                openedAt: pull.created_at,
                status: expected
            },
            true
        ])
    })

    it('refreshes status-only changes even when GitHub timestamps and commit hashes are unchanged', async () => {
        let draft = true
        const pull = {
            base: { ref: 'main', sha: 'base' },
            body: '',
            created_at: '2026-10-05T10:00:00Z',
            head: { ref: 'feature', sha: 'head' },
            html_url: '',
            merge_commit_sha: null,
            merged_at: null,
            number: 42,
            state: 'open',
            title: 'Work',
            updated_at: '2026-10-05T10:00:00Z',
            user: { login: 'me' }
        }
        const github = new GitHub(
            new Http((input) => {
                const url = input instanceof Request ? input.url : String(input)
                return Promise.resolve(Response.json(url.includes('/pulls?') ? [{ ...pull, draft }] : []))
            }),
            () => 'test',
            vi.fn<(...args: unknown[]) => void>()
        )
        const versions: Record<string, string> = {}
        const awaited1 = await github.activities(repository, 'me', [], { versions })
        expect(awaited1[0].pullRequest?.status).toBe('draft')
        draft = false
        const awaited2 = await github.activities(repository, 'me', [], { versions })
        expect(awaited2[0].pullRequest?.status).toBe('open')
        await expect(github.activities(repository, 'me', [], { versions })).resolves.toStrictEqual([])
    })
})

describe('legacy PR context', () => {
    it('does not infer open status from the absence of a merged event', () => {
        const activity = { ...sampleState('2026-10-05').activities[8], kind: 'pr' as const }
        expect([
            pullRequestContext(activity, [activity]).status === undefined,
            activitySchema.parse(activity).pullRequest === undefined
        ]).toStrictEqual([true, true])
    })

    it('reads known opened and merged dates without including reviews or another repository', () => {
        const activity = { ...sampleState('2026-10-05').activities[8], kind: 'pr' as const }
        const opened = {
            ...activity,
            date: '2026-10-05T10:00:00Z',
            id: `${activity.id}:opened`,
            kind: 'opened' as const
        }
        const merged = {
            ...activity,
            date: '2026-10-09T10:00:00Z',
            id: `${activity.id}:merged`,
            kind: 'merged' as const
        }
        const context = pullRequestContext(activity, [
            activity,
            opened,
            merged,
            { ...opened, date: '2020-01-01T00:00:00Z', repositoryId: 'another-repository' },
            { ...activity, date: '2026-10-11T10:00:00Z', kind: 'review' }
        ])
        expect([
            context,
            context.dates?.includes('2020-01-01T00:00:00Z'),
            context.dates?.includes('2026-10-11T10:00:00Z')
        ]).toStrictEqual([
            expect.objectContaining({ mergedAt: merged.date, openedAt: opened.date, status: 'merged' }),
            false,
            false
        ])
    })
})
