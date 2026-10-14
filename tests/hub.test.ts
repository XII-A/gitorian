import { describe, expect, it } from 'vitest'

import { journalWeek, offsetDay, rangeActivities } from '../src/renderer/hub-model'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Activity } from '../src/shared/model'
import { initialState } from '../src/shared/model'
import { required } from '../src/shared/required'

const activity = (id: string, date: string): Activity => ({
    author: '',
    branches: [],
    date,
    deletedBranches: [],
    description: '',
    disposition: 'inbox',
    explicit: false,
    files: [],
    id,
    kind: 'commit',
    repositoryId: 'repo',
    title: id
})

const stateWithPull = () => {
    const state = sampleState('2026-10-05')
    state.settings.timezone = 'UTC'
    const pull: Activity = {
        ...state.activities[8],
        date: '2026-10-07T10:00:00Z',
        id: 'repo:pr:42',
        kind: 'pr',
        prId: 'repo:pr:42',
        pullRequest: {
            closedAt: '2026-10-14T10:00:00Z',
            commitDates: ['2026-10-02T10:00:00Z', '2026-10-07T10:00:00Z'],
            mergedAt: '2026-10-14T10:00:00Z',
            openedAt: '2026-09-30T10:00:00Z',
            status: 'merged'
        },
        title: '#42 Keep uploads safe'
    }
    state.activities = [
        pull,
        {
            ...pull,
            date: required(pull.pullRequest).openedAt,
            id: `${pull.id}:opened`,
            kind: 'opened',
            pullRequest: undefined
        },
        {
            ...pull,
            date: required(required(pull.pullRequest).mergedAt),
            id: `${pull.id}:merged`,
            kind: 'merged',
            pullRequest: undefined
        }
    ]
    return { pull, state }
}

describe('weekly hub calendar ranges', () => {
    it('includes both endpoints in the journal timezone, even across the DST transition', () => {
        const state = initialState()
        state.settings.timezone = 'America/New_York'
        state.repositories.push({
            available: true,
            base: 'main',
            branchBases: {},
            branches: [],
            emails: [],
            id: 'repo',
            name: 'journal',
            path: '',
            remote: '',
            removed: false,
            trackingStart: '2026-01-01'
        })

        state.activities = [
            activity('before', '2026-03-08T04:59:59Z'),
            activity('start', '2026-03-08T05:00:00Z'),
            activity('end', '2026-03-09T03:59:59Z'),
            activity('after', '2026-03-09T04:00:00Z')
        ]
        expect(rangeActivities(state, '2026-03-08', '2026-03-08').map((item) => item.id)).toStrictEqual([
            'end',
            'start'
        ])
        // Legacy tracking decisions must not change the selected date range.
        state.activities[1].disposition = 'dismissed'
        state.activities[2].disposition = 'deferred'
        state.activities[2].deferUntil = '2026-04-01'
        state.entries.push({
            body: { content: [], type: 'doc' },
            date: '2026-03-08',
            id: 'saved-entry',
            refreshedAt: '2026-03-09T04:00:00Z',
            title: 'Earlier reflection',
            url: 'https://notion.so/saved-entry'
        })
        state.coverage.push({ activityId: 'end', entryId: 'saved-entry' })
        state.repositories[0].trackingStart = '2026-04-01'
        state.activities[0].explicit = true
        expect(rangeActivities(state, '2026-03-08', '2026-03-08').map((item) => item.id)).toStrictEqual([
            'end',
            'start'
        ])
        state.repositories[0].removed = true
        expect(rangeActivities(state, '2026-03-08', '2026-03-08')).toStrictEqual([])
    })

    it('uses the selected calendar date and configured week start without shifting timezones twice', () => {
        expect([
            Object.is(journalWeek('2026-10-07', 1), '2026-10-05'),
            Object.is(journalWeek('2026-10-04', 1), '2026-09-28'),
            Object.is(journalWeek('2026-10-04', 0), '2026-10-04'),
            Object.is(offsetDay('2026-03-08', 1), '2026-03-09'),
            Object.is(offsetDay('2026-12-31', 1), '2027-01-01')
        ]).toStrictEqual([true, true, true, true, true])
    })
})

describe('weekly hub pull request grouping', () => {
    it('shows one canonical PR per active week at that week’s latest event, preserving current status', () => {
        const { state, pull } = stateWithPull()
        const snapshot = structuredClone(state.activities)
        for (const [start, end, date] of [
            ['2026-09-28', '2026-10-04', '2026-10-02T10:00:00Z'],
            ['2026-10-05', '2026-10-11', '2026-10-07T10:00:00Z'],
            ['2026-10-12', '2026-10-18', '2026-10-14T10:00:00Z']
        ]) {
            const rows = rangeActivities(state, start, end)
            expect([rows?.length, rows[0], Object.is(rows[0].pullRequest?.status, 'merged')]).toStrictEqual([
                1,
                expect.objectContaining({ date, id: pull.id, kind: 'pr', title: pull.title }),
                true
            ])
        }
        expect([rangeActivities(state, '2026-10-19', '2026-10-25'), state.activities]).toStrictEqual([[], snapshot])
    })

    it('collapses same-week milestones while keeping commits, reviews and other repositories distinct', () => {
        const { state, pull } = stateWithPull()
        required(pull.pullRequest).openedAt = '2026-10-05T10:00:00Z'
        required(pull.pullRequest).mergedAt = '2026-10-09T10:00:00Z'
        required(pull.pullRequest).closedAt = required(pull.pullRequest).mergedAt
        state.activities[1].date = required(pull.pullRequest).openedAt
        state.activities[2].date = required(required(pull.pullRequest).mergedAt)
        state.activities.push(
            { ...pull, id: 'commit', kind: 'commit' },
            { ...pull, id: 'review', kind: 'review' },
            { ...pull, id: 'other-repo:pr:42', repositoryId: state.repositories[0].id }
        )
        const rows = rangeActivities(state, '2026-10-05', '2026-10-11')
        expect([
            rows?.length,
            rows.filter((item) => item.kind === 'pr')?.length,
            Object.is(rows.find((item) => item.id === pull.id)?.date, '2026-10-09T10:00:00Z'),
            rows.map((item) => item.id)?.includes('commit'),
            rows.map((item) => item.id)?.includes('review')
        ]).toStrictEqual([4, 2, true, true, true])
    })

    it('includes closed-without-merge milestones even when the PR has no commits that week', () => {
        const { state, pull } = stateWithPull()
        state.activities = [pull]
        pull.date = '2026-10-02T10:00:00Z'
        pull.pullRequest = {
            closedAt: '2026-10-09T12:00:00Z',
            commitDates: [],
            openedAt: '2026-09-30T10:00:00Z',
            status: 'closed'
        }
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')).toMatchObject([
            { date: '2026-10-09T12:00:00Z', id: pull.id, kind: 'pr', pullRequest: { status: 'closed' } }
        ])
    })

    it('groups legacy records and isolated milestones using a real stored ID', () => {
        const { state, pull } = stateWithPull()
        pull.pullRequest = undefined
        state.activities[1].date = '2026-10-05T10:00:00Z'
        state.activities[2].date = '2026-10-09T10:00:00Z'
        state.activities[2].title = 'Merged #42 Keep uploads safe'
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')).toHaveLength(1)
        state.activities = state.activities.slice(1)
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')).toMatchObject([
            { id: `${pull.id}:merged`, kind: 'pr', title: '#42 Keep uploads safe' }
        ])
    })

    it('uses the journal timezone for milestones and excludes removed repositories', () => {
        const { state, pull } = stateWithPull()
        state.settings.timezone = 'America/New_York'
        state.activities = [pull]
        pull.date = '2026-10-05T02:00:00Z'
        pull.pullRequest = {
            commitDates: ['2026-10-12T03:59:59Z'],
            openedAt: pull.date,
            status: 'open'
        }
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')[0].date).toBe('2026-10-12T03:59:59Z')
        required(state.repositories.find((repo) => repo.id === pull.repositoryId)).removed = true
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')).toStrictEqual([])
    })
})
