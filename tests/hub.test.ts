import { describe, expect, it } from 'vitest'
import { initialState } from '../src/shared/model'
import type { Activity } from '../src/shared/model'
import { journalWeek, offsetDay, rangeActivities } from '../src/renderer/hub-model'
import { sampleState } from '../src/renderer/workspace-sample'

describe('weekly hub calendar ranges', () => {
    it('includes both endpoints in the journal timezone, even across the DST transition', () => {
        const state = initialState()
        state.settings.timezone = 'America/New_York'
        state.repositories.push({
            id: 'repo',
            name: 'journal',
            path: '',
            remote: '',
            base: 'main',
            trackingStart: '2026-01-01',
            emails: [],
            available: true,
            removed: false,
            branches: [],
            branchBases: {}
        })
        const activity = (id: string, date: string): Activity => ({
            id,
            date,
            repositoryId: 'repo',
            kind: 'commit',
            title: id,
            author: '',
            branches: [],
            description: '',
            files: [],
            disposition: 'inbox',
            explicit: false,
            deletedBranches: []
        })
        state.activities = [
            activity('before', '2026-03-08T04:59:59Z'),
            activity('start', '2026-03-08T05:00:00Z'),
            activity('end', '2026-03-09T03:59:59Z'),
            activity('after', '2026-03-09T04:00:00Z')
        ]
        expect(rangeActivities(state, '2026-03-08', '2026-03-08').map((item) => item.id)).toEqual(['end', 'start'])
        // Legacy tracking decisions must not change the selected date range.
        state.activities[1].disposition = 'dismissed'
        state.activities[2].disposition = 'deferred'
        state.activities[2].deferUntil = '2026-04-01'
        state.entries.push({
            id: 'saved-entry',
            title: 'Earlier reflection',
            date: '2026-03-08',
            url: 'https://notion.so/saved-entry',
            body: { type: 'doc', content: [] },
            refreshedAt: '2026-03-09T04:00:00Z'
        })
        state.coverage.push({ activityId: 'end', entryId: 'saved-entry' })
        state.repositories[0].trackingStart = '2026-04-01'
        state.activities[0].explicit = true
        expect(rangeActivities(state, '2026-03-08', '2026-03-08').map((item) => item.id)).toEqual(['end', 'start'])
        state.repositories[0].removed = true
        expect(rangeActivities(state, '2026-03-08', '2026-03-08')).toEqual([])
    })
    it('uses the selected calendar date and configured week start without shifting timezones twice', () => {
        expect(journalWeek('2026-10-07', 1)).toBe('2026-10-05')
        expect(journalWeek('2026-10-04', 1)).toBe('2026-09-28')
        expect(journalWeek('2026-10-04', 0)).toBe('2026-10-04')
        expect(offsetDay('2026-03-08', 1)).toBe('2026-03-09')
        expect(offsetDay('2026-12-31', 1)).toBe('2027-01-01')
    })
})

describe('weekly hub pull request grouping', () => {
    const stateWithPull = () => {
        const state = sampleState('2026-10-05')
        state.settings.timezone = 'UTC'
        const pull: Activity = {
            ...state.activities[8],
            id: 'repo:pr:42',
            prId: 'repo:pr:42',
            kind: 'pr',
            title: '#42 Keep uploads safe',
            date: '2026-10-07T10:00:00Z',
            pullRequest: {
                status: 'merged',
                openedAt: '2026-09-30T10:00:00Z',
                commitDates: ['2026-10-02T10:00:00Z', '2026-10-07T10:00:00Z'],
                closedAt: '2026-10-14T10:00:00Z',
                mergedAt: '2026-10-14T10:00:00Z'
            }
        }
        state.activities = [
            pull,
            {
                ...pull,
                pullRequest: undefined,
                id: `${pull.id}:opened`,
                kind: 'opened',
                date: pull.pullRequest!.openedAt
            },
            {
                ...pull,
                pullRequest: undefined,
                id: `${pull.id}:merged`,
                kind: 'merged',
                date: pull.pullRequest!.mergedAt!
            }
        ]
        return { state, pull }
    }

    it('shows one canonical PR per active week at that week’s latest event, preserving current status', () => {
        const { state, pull } = stateWithPull()
        const snapshot = structuredClone(state.activities)
        for (const [start, end, date] of [
            ['2026-09-28', '2026-10-04', '2026-10-02T10:00:00Z'],
            ['2026-10-05', '2026-10-11', '2026-10-07T10:00:00Z'],
            ['2026-10-12', '2026-10-18', '2026-10-14T10:00:00Z']
        ]) {
            const rows = rangeActivities(state, start, end)
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({ id: pull.id, kind: 'pr', title: pull.title, date })
            expect(rows[0].pullRequest?.status).toBe('merged')
        }
        expect(rangeActivities(state, '2026-10-19', '2026-10-25')).toEqual([])
        expect(state.activities).toEqual(snapshot)
    })

    it('collapses same-week milestones while keeping commits, reviews and other repositories distinct', () => {
        const { state, pull } = stateWithPull()
        pull.pullRequest!.openedAt = '2026-10-05T10:00:00Z'
        pull.pullRequest!.mergedAt = '2026-10-09T10:00:00Z'
        pull.pullRequest!.closedAt = pull.pullRequest!.mergedAt
        state.activities[1].date = pull.pullRequest!.openedAt
        state.activities[2].date = pull.pullRequest!.mergedAt
        state.activities.push(
            { ...pull, id: 'commit', kind: 'commit' },
            { ...pull, id: 'review', kind: 'review' },
            { ...pull, id: 'other-repo:pr:42', repositoryId: state.repositories[0].id }
        )
        const rows = rangeActivities(state, '2026-10-05', '2026-10-11')
        expect(rows).toHaveLength(4)
        expect(rows.filter((item) => item.kind === 'pr')).toHaveLength(2)
        expect(rows.find((item) => item.id === pull.id)?.date).toBe('2026-10-09T10:00:00Z')
        expect(rows.map((item) => item.id)).toContain('commit')
        expect(rows.map((item) => item.id)).toContain('review')
    })

    it('includes closed-without-merge milestones even when the PR has no commits that week', () => {
        const { state, pull } = stateWithPull()
        state.activities = [pull]
        pull.date = '2026-10-02T10:00:00Z'
        pull.pullRequest = {
            status: 'closed',
            openedAt: '2026-09-30T10:00:00Z',
            commitDates: [],
            closedAt: '2026-10-09T12:00:00Z'
        }
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')).toMatchObject([
            { id: pull.id, kind: 'pr', date: '2026-10-09T12:00:00Z', pullRequest: { status: 'closed' } }
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
            status: 'open',
            openedAt: pull.date,
            commitDates: ['2026-10-12T03:59:59Z']
        }
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')[0].date).toBe('2026-10-12T03:59:59Z')
        state.repositories.find((repo) => repo.id === pull.repositoryId)!.removed = true
        expect(rangeActivities(state, '2026-10-05', '2026-10-11')).toEqual([])
    })
})
