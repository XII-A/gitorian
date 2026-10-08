import { initialState, shiftWeek, weekOf } from '../shared/model'
import type { Activity, DesktopBridge, JournalNode } from '../shared/model'
import { offsetDay } from './hub-model'

const paragraph = (text: string): JournalNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (text: string): JournalNode => ({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text }]
})

/** An isolated, in-memory journal. No command reaches the desktop or external services. */
export function createSampleJournal(): DesktopBridge {
    const state = initialState()
    const week = weekOf(new Date(), state.settings)
    state.repositories = ['weekly-j', 'arc', 'journal-sync'].map((name, index) => ({
        id: `sample-repo-${index}`,
        name,
        path: `/projects/${name}`,
        remote: `https://github.com/mira-chen/${name}`,
        base: 'main',
        trackingStart: shiftWeek(week, -4),
        emails: ['mira@example.com'],
        available: true,
        removed: false,
        branches: ['main', 'feat/weekly-notes', 'fix/local-save'],
        branchBases: {}
    }))
    const work: [string, number, Activity['kind'], string, number][] = [
        ['Make room for a quieter weekly journal', 0, 'pr', 'feat/weekly-notes', 4],
        ['Keep the selected week when opening a draft', 0, 'commit', 'feat/weekly-notes', 4],
        ['Review the date range keyboard interaction', 1, 'review', 'feat/calendar', 3],
        ['Save a recovery copy before syncing', 2, 'commit', 'fix/local-save', 3],
        ['Refine the spacing between journal sections', 1, 'commit', 'polish/journal-spacing', 3],
        ['Add a reusable week range picker', 1, 'merged', 'feat/calendar', 2],
        ['Restore drafts after an interrupted save', 2, 'pr', 'fix/local-save', 2],
        ['Simplify the work selection flow', 0, 'commit', 'feat/weekly-notes', 2],
        ['Show changed files with readable diff gutters', 0, 'commit', 'feat/diff-view', 1],
        ['Review the journal export format', 2, 'review', 'feat/journal-export', 1],
        ['Respect reduced motion in calendar transitions', 1, 'commit', 'fix/reduced-motion', 1],
        ['Gather work from the connected projects', 2, 'commit', 'feat/multi-project', 0],
        ['Set up the weekly writing template', 0, 'commit', 'feat/weekly-notes', 0],
        ['Keep branch names readable on small screens', 1, 'commit', 'polish/branch-labels', 0]
    ]
    const elapsedDays = Math.floor((new Date().getTime() - new Date(week + 'T00:00:00').getTime()) / 86400000)
    const paths = ['src/renderer/journal.ts', 'src/components/calendar.tsx', 'src/sync/recovery.ts']
    work.forEach(([title, repo, kind, branch, day], index) => {
        const id = `sample-work-${index}`
        const path = paths[repo]
        state.activities.push({
            id,
            repositoryId: state.repositories[repo].id,
            kind,
            title,
            date: `${offsetDay(week, Math.min(day, elapsedDays))}T${String(16 - (index % 6)).padStart(2, '0')}:20:00Z`,
            author: 'mira@example.com',
            branches: [branch],
            sha: (index + 1).toString(16).padStart(7, '9'),
            prId: kind !== 'commit' ? `mira/${repo}/${38 + index}` : undefined,
            url: `https://github.com/mira-chen/${state.repositories[repo].name}/${kind === 'commit' ? 'commit' : 'pull'}/${38 + index}`,
            description:
                repo === 0
                    ? 'The weekly journal now keeps the writing and its supporting work together. Date changes preserve the draft and its linked activity.'
                    : repo === 1
                      ? 'A small refinement to the shared interaction: predictable keyboard focus, clearer spacing, and less motion when it is not needed.'
                      : 'Recovery now happens before the sync begins, so an interrupted connection cannot take the local draft with it.',
            files: [
                { name: path, status: 'modified' },
                { name: path.replace('.ts', '.test.ts'), status: 'modified' }
            ],
            disposition: 'inbox',
            explicit: true,
            deletedBranches: [],
            diffRevision: kind === 'pr' ? `revision-${index}` : undefined,
            revision: kind === 'pr' ? `revision-${index}` : undefined
        })
        state.diffs[id] =
            `diff --git a/${path} b/${path}\nindex 2b87f31..81ab493 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,7 +1,10 @@\n export function saveJournal(draft) {\n-  return sync(draft)\n+  const snapshot = createSnapshot(draft)\n+  saveLocally(snapshot)\n+\n+  return sync(snapshot).catch(() => snapshot)\n }\n \n export function restoreJournal() {\n   return readLocalDraft()\n }\n`
    })
    state.drafts.push({
        id: 'sample-draft',
        week,
        title: 'A quieter place for the week',
        body: {
            type: 'doc',
            content: [
                paragraph(
                    'This week I spent more time on the spaces between things: fewer controls, clearer transitions, and a journal that feels easier to return to.'
                ),
                heading('What moved forward'),
                paragraph(
                    'The weekly overview is in place. I can follow the work by day, open a change, and carry the same week into the journal. The small details are starting to feel connected.'
                ),
                {
                    type: 'bulletList',
                    content: [
                        'A calmer work list, with branches and pull requests kept in context.',
                        'Draft recovery before sync, so interrupted connections are easier to recover from.'
                    ].map((text) => ({ type: 'listItem', content: [paragraph(text)] }))
                },
                heading('What I learned'),
                paragraph(
                    'Removing a control helps most when the next step becomes clearer. Keeping the work close to the writing matters more than fitting every tool into the first screen.'
                ),
                heading('Next week'),
                paragraph(
                    'Try the new workspace during a real review. Notice where I reach for context, and where I just want to keep writing.'
                )
            ]
        },
        selections: [
            { activityId: 'sample-work-0', revision: 'revision-0' },
            { activityId: 'sample-work-3' },
            { activityId: 'sample-work-5' }
        ],
        updatedAt: new Date().toISOString()
    })
    const currentActivities = [...state.activities]
    const currentDraft = state.drafts[0]
    for (const offset of [1, 2, 3]) {
        const pastWeek = shiftWeek(week, -offset)
        for (const activity of currentActivities) {
            const id = activity.id + '-week-' + String(offset)
            state.activities.push({
                ...activity,
                id,
                date: offsetDay(activity.date.slice(0, 10), -7 * offset) + activity.date.slice(10)
            })
            state.diffs[id] = state.diffs[activity.id]
        }
        state.drafts.push({
            ...structuredClone(currentDraft),
            id: currentDraft.id + '-week-' + String(offset),
            week: pastWeek,
            title:
                offset === 1
                    ? 'Small steps, clearer direction'
                    : offset === 2
                      ? 'Making the everyday work easier'
                      : 'Finding a steadier rhythm',
            selections: currentDraft.selections.map((selection) => ({
                ...selection,
                activityId: selection.activityId + '-week-' + String(offset)
            }))
        })
    }
    state.features.push({
        id: 'sample-feature',
        name: 'Weekly journal',
        archived: false,
        members: ['branch:sample-repo-0:feat/weekly-notes']
    })
    state.lastRefreshed = new Date().toISOString()
    let sequence = 0
    return {
        invoke(command) {
            try {
                switch (command.type) {
                    case 'state':
                    case 'refresh':
                    case 'details':
                        break
                    case 'newDraft':
                        state.drafts.push({
                            id: `sample-draft-${++sequence}`,
                            week: command.week,
                            title: 'Notes from the week',
                            body: { type: 'doc', content: [paragraph('')] },
                            selections: [],
                            updatedAt: new Date().toISOString()
                        })
                        break
                    case 'draft': {
                        const draft = state.drafts.find((item) => item.id === command.draft.id)
                        if (!draft || draft.publishedEntryId) throw new Error('Choose an editable draft')
                        draft.title = command.draft.title
                        draft.body = structuredClone(command.draft.body)
                        draft.updatedAt = new Date().toISOString()
                        break
                    }
                    case 'select': {
                        const draft = state.drafts.find((draft) => draft.id === command.draftId)
                        const activity = state.activities.find((item) => item.id === command.activityId)
                        if (draft && activity)
                            draft.selections = command.included
                                ? [
                                      ...draft.selections.filter((item) => item.activityId !== activity.id),
                                      { activityId: activity.id, revision: activity.revision }
                                  ]
                                : draft.selections.filter((item) => item.activityId !== activity.id)
                        break
                    }
                    case 'settings':
                        state.settings = structuredClone(command.settings)
                        break
                    case 'disposition': {
                        const activity = state.activities.find((item) => item.id === command.activityId)
                        if (activity) {
                            activity.disposition = command.disposition
                            activity.deferUntil = command.until
                            activity.reason = command.reason
                        }
                        break
                    }
                    case 'feature': {
                        const feature = {
                            id: command.id || `sample-feature-${++sequence}`,
                            name: command.name,
                            archived: command.archived,
                            members: command.members
                        }
                        state.features = [...state.features.filter((item) => item.id !== feature.id), feature]
                        break
                    }
                    case 'history':
                        return Promise.resolve({
                            state: structuredClone(state),
                            connections: { github: false, notion: false, protectedStorage: false },
                            activityIds: state.activities
                                .filter(
                                    (item) =>
                                        item.repositoryId === command.repositoryId &&
                                        item.branches.includes(command.branch)
                                )
                                .map((item) => item.id)
                        })
                    case 'coverage':
                        state.coverage = state.coverage.filter(
                            (item) => item.activityId !== command.activityId || item.entryId !== command.entryId
                        )
                        if (command.linked)
                            state.coverage.push({ activityId: command.activityId, entryId: command.entryId })
                        break
                    default:
                        throw new Error(
                            'This action needs real data. Switch to real data in the desktop app to continue.'
                        )
                }
                return Promise.resolve({
                    state: structuredClone(state),
                    connections: { github: false, notion: false, protectedStorage: false }
                })
            } catch (error) {
                return Promise.reject(error instanceof Error ? error : new Error(String(error)))
            }
        }
    }
}
