import { describe, expect, it } from 'vitest'
import { sampleState } from './workspace-fixture'
import { activityLink } from '../src/renderer/workspace-model'
import { projectActivityRange, type ActivityFilters } from '../src/renderer/activity-projection'
import { offsetDay } from '../src/renderer/hub-model'
import type { State } from '../src/shared/model'

const filterWorkspaceActivity = (state: State, start: string, filters: ActivityFilters) =>
    projectActivityRange(state, start, offsetDay(start, 6)).select(filters).items

describe('weekly activity and sample references', () => {
    const state = sampleState('2026-10-05')
    const filters = { project: 'all', branch: 'all', kind: 'all', search: '' }
    it('shares project/day counts and groups while branch, author and kind narrow only the rows', () => {
        const base = state.activities[0]
        const scoped = {
            ...state,
            settings: { ...state.settings, timezone: 'America/New_York' },
            activities: [
                { ...base, id: 'commit', date: '2026-10-06T02:00:00Z', author: 'Alice', branches: ['topic'] },
                { ...base, id: 'review', kind: 'review' as const, date: '2026-10-06T03:00:00Z' },
                { ...base, id: 'tomorrow', date: '2026-10-06T05:00:00Z' },
                { ...base, id: 'previous', date: '2026-10-06T02:00:00Z', previousSource: true }
            ]
        }
        const projection = projectActivityRange(scoped, '2026-10-05', '2026-10-11')
        const result = projection.select({
            project: base.repositoryId,
            day: '2026-10-05',
            kind: 'commit',
            branch: 'topic',
            authors: ['ALICE']
        })
        expect(result.counts).toEqual({ all: 2, commit: 1, 'change-request': 1 })
        expect(result.items.map((item) => item.id)).toEqual(['commit'])
        expect(result.groups.map(([day, items]) => [day, items.map((item) => item.id)])).toEqual([
            ['2026-10-05', ['commit']]
        ])
        expect(projection.select({ day: '2026-10-07' }).counts.all).toBe(0)
        expect(projection.select({ kind: 'previous' }).items.map((item) => item.id)).toEqual(['previous'])
        expect(projection.items.map((item) => item.id)).not.toContain('previous')
    })
    it('retains the aggregate matching count when a busy week is narrowed to a moderate day', () => {
        const base = state.activities[0]
        const busy = {
            ...state,
            settings: { ...state.settings, timezone: 'UTC' },
            activities: Array.from({ length: 600 }, (_, index) => ({
                ...base,
                id: `commit-${index}`,
                date: `2026-10-0${5 + Math.floor(index / 150)}T12:00:00Z`
            }))
        }
        const projection = projectActivityRange(busy, '2026-10-05', '2026-10-11')
        const selected = projection.select({ day: '2026-10-05' })
        expect(selected.items).toHaveLength(150)
        expect(selected.matchingCount).toBe(600)
        expect(selected.counts.all).toBe(150)
        expect(projection.select({ day: '2026-10-05', kind: 'change-request' }).matchingCount).toBe(0)
    })
    it('combines branch, project and search while keeping work inside its week', () => {
        expect(filterWorkspaceActivity(state, '2026-10-05', filters)).toHaveLength(23)
        expect(filterWorkspaceActivity(state, '2026-10-12', filters)).toHaveLength(0)
        const found = filterWorkspaceActivity(state, '2026-10-05', {
            ...filters,
            project: 'sample-repo-0',
            branch: 'feat/offline-queue',
            kind: 'commit',
            search: 'backoff'
        })
        expect(found.map((activity) => activity.id)).toEqual(['sample:2026-10-05:0'])
        expect(
            filterWorkspaceActivity(state, '2026-10-05', { ...filters, kind: 'change-request' }).every(
                (activity) => activity.kind !== 'commit'
            )
        ).toBe(true)
    })
    it('matches any author tag without losing project, branch or week filters', () => {
        const authored = {
            ...state,
            activities: state.activities.map((activity, index) => ({
                ...activity,
                author: index === 0 ? 'Alice@example.com' : 'bob@example.com'
            }))
        }
        const selected = { ...filters, project: 'sample-repo-0', branch: 'feat/offline-queue' }
        expect(
            filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['ALICE'] }).map((item) => item.id)
        ).toEqual(['sample:2026-10-05:0'])
        expect(filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['ALICE', 'bob'] })).toEqual(
            filterWorkspaceActivity(authored, '2026-10-05', selected)
        )
        expect(filterWorkspaceActivity(authored, '2026-10-12', { ...selected, authors: ['alice'] })).toEqual([])
        expect(filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['unknown'] })).toEqual([])
    })
    it('generates a commit citation only from a web GitHub remote and preserves explicit PR links', () => {
        expect(activityLink(state.activities[0], state)).toBe(
            'https://github.com/gitorian-example/mobile-app/commit/a3f9c218912ab0'
        )
        expect(activityLink(state.activities[1], state)).toBe(state.activities[1].url)
        const local = structuredClone(state)
        local.repositories[0].remote = 'C:\\work\\mobile-app'
        expect(activityLink(local.activities[0], local)).toBeUndefined()
    })
})
