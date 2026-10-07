import { describe, expect, it } from 'vitest'
import { initialState } from '../src/shared/model'
import type { Activity } from '../src/shared/model'
import { journalWeek, offsetDay, rangeActivities } from '../src/renderer/hub-model'

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
        state.activities[1].disposition = 'dismissed'
        expect(rangeActivities(state, '2026-03-08', '2026-03-08').map((item) => item.id)).toEqual(['end'])
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
