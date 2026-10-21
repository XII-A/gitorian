import { describe, expect, it } from 'vitest'
import { sampleState } from '../src/renderer/workspace-sample'
import { activityLink, filterWorkspaceActivity } from '../src/renderer/workspace-model'

describe('weekly activity and sample references', () => {
    const state = sampleState('2026-10-05')
    const filters = { project: 'all', branch: 'all', kind: 'all', search: '' }
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
            filterWorkspaceActivity(state, '2026-10-05', { ...filters, kind: 'pr' }).every(
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
            'https://github.com/weekly-j-example/mobile-app/commit/a3f9c218912ab0'
        )
        expect(activityLink(state.activities[1], state)).toBe(state.activities[1].url)
        const local = structuredClone(state)
        local.repositories[0].remote = 'C:\\work\\mobile-app'
        expect(activityLink(local.activities[0], local)).toBeUndefined()
    })
})
