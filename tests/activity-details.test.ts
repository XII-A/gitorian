// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityDescription } from '../src/renderer/activity-description'
import { activityBranches, changeKind, markdownUrl, orderedFiles } from '../src/renderer/activity-details'
import { ActivityFiles } from '../src/renderer/activity-files'
import { Timeline } from '../src/renderer/components/arc/timeline/timeline'
import { PullRequestLifecycle, PullRequestStatus } from '../src/renderer/pull-request-lifecycle'
import { sampleState } from '../src/renderer/workspace-sample'
import { required } from '../src/shared/required'

import timelineStyles from '../src/renderer/components/arc/timeline/timeline.module.css'

const state = sampleState('2026-10-05')
const activity = { ...state.activities[8], url: 'https://github.com/example/project/pull/12' }
const repository = { ...state.repositories[0], base: 'main', remote: 'https://github.com/example/project.git' }
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(element)
    return container
}

describe('pull request lifecycle presentation', () => {
    it.each(['open', 'draft', 'closed', 'merged'] as const)('labels %s as current status', (status) => {
        const pull = { ...activity, pullRequest: { commitDates: [], openedAt: activity.date, status } }
        const container = render(createElement(PullRequestStatus, { activities: [pull], activity: pull }))
        const label = `${status[0].toUpperCase()}${status.slice(1)}`
        expect([
            Object.is(container.textContent, label),
            Object.is(container.firstElementChild?.getAttribute('aria-label'), `Current status: ${label}`)
        ]).toStrictEqual([true, true])
    })

    it('shows lifecycle milestones newest first with timezone-aware accessible times', () => {
        const pull = {
            ...activity,
            pullRequest: {
                closedAt: '2026-10-09T10:00:00Z',
                commitDates: ['2026-10-06T10:00:00Z', '2026-10-08T10:00:00Z'],
                mergedAt: '2026-10-09T10:00:00Z',
                openedAt: '2026-10-05T10:00:00Z',
                status: 'merged' as const
            }
        }
        const container = render(
            createElement(PullRequestLifecycle, {
                activities: [pull],
                activity: pull,
                refreshedAt: '2026-10-11T12:00:00Z',
                timezone: 'Europe/Istanbul'
            })
        )
        expect([
            [...container.querySelectorAll('li')].map((row) => row.textContent),
            Object.is(container.querySelector('time')?.getAttribute('datetime'), '2026-10-09T10:00:00.000Z'),
            container.querySelector('time')?.getAttribute('title')?.includes('1:00 PM'),
            container.querySelector('time')?.textContent?.includes('Oct 9, 1:00 PM'),
            container.querySelectorAll('[role="heading"]')?.length,
            container.querySelectorAll('ol')?.length,
            container.querySelectorAll(`.${timelineStyles.segment}`)?.length,
            container.textContent?.includes('update'),
            container.textContent?.includes('Closed without merging')
        ]).toStrictEqual([
            [
                expect.stringContaining('Merged pull request'),
                expect.stringContaining('Latest commit'),
                expect.stringContaining('Opened pull request')
            ],
            true,
            true,
            true,
            0,
            1,
            2,
            false,
            false
        ])
    })

    it('shows closed without merging and avoids duplicated opening/commit timestamps', () => {
        const pull = {
            ...activity,
            pullRequest: {
                closedAt: '2026-10-09T10:00:00Z',
                commitDates: [activity.date],
                openedAt: activity.date,
                status: 'closed' as const
            }
        }
        const container = render(
            createElement(PullRequestLifecycle, {
                activities: [pull],
                activity: pull,
                timezone: 'UTC'
            })
        )
        expect([
            container.querySelectorAll('li')?.length,
            container.textContent?.includes('Closed without merging')
        ]).toStrictEqual([2, true])
    })

    it('keeps missing legacy status honest and provides a history recovery hint', () => {
        const container = render(createElement(PullRequestStatus, { activities: [activity], activity }))
        expect(container.textContent).toBe('Status unavailable')
        const history = render(
            createElement(PullRequestLifecycle, { activities: [activity], activity, timezone: 'UTC' })
        )
        expect(history.textContent).toContain('Refresh activity')
    })
})

describe('timeline date grouping', () => {
    const events = [
        { at: '2026-10-05T10:00:00Z', id: 'opened', title: 'Opened pull request' },
        { at: '2026-10-09T10:00:00Z', id: 'merged', title: 'Merged pull request' }
    ]
    const props = { events, label: 'History', now: Date.parse('2026-10-11T12:00:00Z'), timeZone: 'Europe/Istanbul' }

    it('connects Monday and Friday in a single list with dates instead of day headings and counts', () => {
        const container = render(createElement(Timeline, { ...props, groupByDay: false }))
        expect([
            container.querySelectorAll('ol')?.length,
            container.querySelectorAll('li')?.length,
            container.querySelectorAll(`.${timelineStyles.segment}`)?.length,
            [...container.querySelectorAll('time')].map((time) => time.querySelector('[aria-hidden]')?.textContent),
            container.querySelector('[role="heading"]') === null,
            container.querySelector('[aria-labelledby]') === null,
            container.textContent?.includes('update')
        ]).toStrictEqual([1, 2, 1, ['Oct 9, 1:00 PM', 'Oct 5, 1:00 PM'], true, true, false])
    })

    it('preserves grouped feed headings and counts by default', () => {
        const container = render(createElement(Timeline, props))
        expect([
            container.querySelectorAll('ol')?.length,
            container.querySelectorAll('[role="heading"]')?.length,
            container.querySelectorAll(`.${timelineStyles.segment}`)?.length,
            container.textContent?.includes('1 update'),
            Object.is(container.querySelector('time')?.querySelector('[aria-hidden]')?.textContent, '1:00 PM')
        ]).toStrictEqual([2, 2, 0, true, true])
    })

    it('keeps the year visible for older events, using the display timezone at year boundaries', () => {
        const container = render(
            createElement(Timeline, {
                ...props,
                events: [
                    { at: '2025-10-05T10:00:00Z', id: 'older', title: 'Older event' },
                    { at: '2025-12-31T23:30:00Z', id: 'boundary', title: 'New year event' }
                ],
                groupByDay: false
            })
        )
        expect(
            [...container.querySelectorAll('time')].map((time) => time.querySelector('[aria-hidden]')?.textContent)
        ).toStrictEqual(['Jan 1, 2:30 AM', 'Oct 5, 2025, 1:00 PM'])
    })
})

describe('activity branch context', () => {
    const commit = {
        ...activity,
        branches: ['development', 'feature/work', 'origin/development'],
        kind: 'commit' as const,
        sha: 'abc123'
    }

    it('uses one containing branch without claiming that it is the original branch', () => {
        expect(activityBranches(commit)).toStrictEqual({
            label: 'Found on',
            primary: 'development',
            remaining: ['feature/work', 'origin/development']
        })
    })

    it('uses a matching PR source branch and excludes another repository with the same head', () => {
        const pull = { ...activity, branches: ['feature/work'], head: commit.sha }
        const unrelated = { ...pull, branches: ['other/work'], repositoryId: 'another-repository' }
        expect(activityBranches(commit, [pull, unrelated])).toStrictEqual({
            label: 'Source branch',
            primary: 'feature/work',
            remaining: ['development', 'origin/development']
        })
    })

    it('does not guess between conflicting PR sources or absent commit hashes', () => {
        const pull = { ...activity, branches: ['feature/work'], head: commit.sha }
        expect([
            Object.is(activityBranches(commit, [pull, { ...pull, branches: ['another/work'] }]).label, 'Found on'),
            Object.is(activityBranches({ ...commit, sha: undefined }, [pull]).label, 'Found on')
        ]).toStrictEqual([true, true])
    })

    it('keeps PR source context and counts unique remaining branches without altering metadata', () => {
        const pull = { ...activity, branches: ['feature/work', 'development', 'development'] }
        expect([
            activityBranches(pull),
            pull.branches?.length,
            activityBranches({ ...commit, branches: [] }).primary === undefined
        ]).toStrictEqual([
            {
                label: 'Source branch',
                primary: 'feature/work',
                remaining: ['development']
            },
            3,
            true
        ])
    })
})

describe('activity descriptions', () => {
    it('renders GitHub Markdown with headings, code, tasks, tables, and external links', () => {
        const description =
            '## Summary\n\nKeep **pending uploads** in `storage`.\n\n- [x] Tested\n- [ ] Follow up\n\n| Before | After |\n| --- | --- |\n| Lost | Saved |\n\n```ts\nconst safe = true\n```\n\n[Details](https://github.com/example/project/pull/12)'
        const container = render(
            createElement(ActivityDescription, { activity: { ...activity, description }, repository })
        )
        expect([
            Object.is(container.querySelector('h4')?.textContent, 'Summary'),
            Object.is(container.querySelector('strong')?.textContent, 'pending uploads'),
            container.querySelectorAll('input:disabled')?.length,
            container.querySelector('input:checked') === null,
            Object.is(container.querySelector('table td')?.textContent, 'Lost'),
            container.querySelector('pre code')?.textContent?.includes('const safe = true'),
            Object.is(container.querySelector('a')?.getAttribute('target'), '_blank')
        ]).toStrictEqual([true, true, 2, false, true, true, true])
    })

    it('does not execute raw HTML or unsafe link and image schemes', () => {
        const description =
            '<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![unsafe image](data:text/html,bad)'
        const container = render(createElement(ActivityDescription, { activity: { ...activity, description } }))
        expect([
            container.querySelector('script') === null,
            container.querySelector('a') === null,
            container.querySelector('img') === null,
            container.textContent?.includes('unsafe')
        ]).toStrictEqual([true, true, true, true])
    })

    it('preserves diff signs, spacing and literal markup with full-line change semantics', () => {
        const source =
            '--- a/actions.ts\n+++ b/actions.ts\n@@ -1,2 +1,3 @@\n- Urgent only\n+ Search with highlights                         Add button\n\n  Unchanged context\n+ <script>alert(1)</script>\n'
        const container = render(
            createElement(ActivityDescription, {
                activity: { ...activity, description: `\`\`\`diff\n${source}\`\`\`` }
            })
        )
        const block = container.querySelector('pre.hub-detail-diff code')
        expect([
            Object.is(block?.closest('[role="region"]')?.getAttribute('aria-label'), 'Diff code block'),
            Object.is(block?.textContent, source),
            block?.querySelectorAll('[data-diff-line="added"]')?.length,
            block?.querySelectorAll('[data-diff-line="removed"]')?.length,
            block?.querySelectorAll('[data-diff-line="context"]')?.length,
            block?.querySelector('script') === null
        ]).toStrictEqual([true, true, 2, 1, 5, true])
    })

    it('keeps ordinary code and Markdown lists outside diff highlighting', () => {
        const container = render(
            createElement(ActivityDescription, {
                activity: {
                    ...activity,
                    description: '```txt\n- ordinary text\n+ ordinary text\n```\n\n- A list item\n\n`+ inline`'
                }
            })
        )
        expect([
            container.querySelector('.hub-detail-diff') === null,
            Object.is(container.querySelector('pre code')?.textContent, '- ordinary text\n+ ordinary text\n'),
            Object.is(container.querySelector('li')?.textContent, 'A list item'),
            Object.is(container.querySelector('p code')?.textContent, '+ inline')
        ]).toStrictEqual([true, true, true, true])
    })

    it('resolves repository links, PR fragments, and refuses credentialed URLs', () => {
        expect(markdownUrl('README.md', activity, repository)).toBe(
            'https://github.com/example/project/blob/main/README.md'
        )
        expect(markdownUrl('#discussion', activity, repository)).toBe(`${activity.url}#discussion`)
        expect(markdownUrl('https://user:pass@github.com/example', activity, repository)).toBe('')
        expect(markdownUrl('javascript:alert(1)', activity, repository)).toBe('')
        expect(
            markdownUrl('README.md', activity, { ...repository, remote: 'git@github.com:example/project.git' })
        ).toBe('https://github.com/example/project/blob/main/README.md')
    })

    it('keeps commit messages literal instead of interpreting their punctuation as Markdown', () => {
        const container = render(
            createElement(ActivityDescription, {
                activity: { ...activity, description: 'Fix *glob* matching\n\n#602', kind: 'commit' }
            })
        )
        expect([
            container.querySelector('em') === null,
            Object.is(container.textContent, 'Fix *glob* matching\n\n#602')
        ]).toStrictEqual([true, true])
    })
})

describe('activity files', () => {
    it.each([
        ['D', 'deleted'],
        ['removed', 'deleted'],
        ['A', 'added'],
        ['added', 'added'],
        ['R100', 'renamed'],
        ['renamed', 'renamed'],
        ['M', 'modified'],
        ['modified', 'modified'],
        ['C75', 'copied'],
        ['typechanged', 'other']
    ])('normalizes %s', (status, kind) => {
        expect(changeKind(status)).toBe(kind)
    })

    it('sorts deleted files first without mutating source data and shows rename paths and totals', () => {
        const files = [
            { name: 'src/z.ts', status: 'M' },
            { name: 'src/new.ts', previousName: 'src/old.ts', status: 'R100' },
            { name: 'src/gone.ts', status: 'removed' },
            { name: 'src/added.ts', status: 'added' }
        ]
        expect([orderedFiles(files).map((file) => file.name), Object.is(files[0].name, 'src/z.ts')]).toStrictEqual([
            ['src/gone.ts', 'src/added.ts', 'src/new.ts', 'src/z.ts'],
            true
        ])
        const container = render(createElement(ActivityFiles, { files }))
        expect([
            container.querySelector<HTMLElement>('li')?.dataset.change,
            Object.is(
                container.querySelector('[data-change="renamed"] .hub-detail-file-directory')?.textContent,
                'src/old.ts → src/new.ts'
            ),
            Object.is(container.querySelector('[data-value="deleted"]')?.textContent, 'Deleted1'),
            Object.is(container.querySelector('li .hub-sr-only')?.textContent, 'Deleted')
        ]).toStrictEqual(['deleted', true, true, true])
    })

    it('displays legacy local rename snapshots using old and new paths', () => {
        const container = render(
            createElement(ActivityFiles, { files: [{ name: 'old/file.ts\tnew/file.ts', status: 'R100' }] })
        )
        expect([
            Object.is(container.querySelector('.hub-detail-file-name')?.textContent, 'file.ts'),
            Object.is(container.querySelector('.hub-detail-file-directory')?.textContent, 'old/file.ts → new/file.ts')
        ]).toStrictEqual([true, true])
    })

    it('filters the ledger with accurate counts and restores every file with All', async () => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
        const container = document.createElement('div')
        document.body.append(container)
        const root = createRoot(container)
        const files = [
            { name: 'src/changed.ts', status: 'M' },
            { name: 'src/new.ts', status: 'added' },
            { name: 'src/gone.ts', status: 'D' },
            { name: 'test/changed.ts', status: 'modified' }
        ]
        try {
            await act(async () => {
                root.render(createElement(ActivityFiles, { files }))
                await Promise.resolve()
            })
            const modified = required(container.querySelector<HTMLButtonElement>('[data-value="modified"]'))
            expect([
                Object.is(modified.textContent, 'Modified2'),
                container.querySelector('[data-value="renamed"]') === null
            ]).toStrictEqual([true, true])
            await act(async () => {
                modified.click()
                await Promise.resolve()
            })
            expect([
                Object.is(modified.getAttribute('aria-pressed'), 'true'),
                container.querySelectorAll('li')?.length,
                container.querySelector('li[data-change="added"]') === null
            ]).toStrictEqual([true, 2, true])
            await act(async () => {
                modified.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }))
                await Promise.resolve()
            })
            expect([
                Object.is(container.querySelector('[data-value="all"]')?.getAttribute('aria-pressed'), 'true'),
                container.querySelectorAll('li')?.length,
                container.querySelector<HTMLElement>('li')?.dataset.change
            ]).toStrictEqual([true, 4, 'deleted'])
            await act(async () => {
                required(container.querySelector<HTMLButtonElement>('[data-value="deleted"]')).click()
                await Promise.resolve()
            })
            await act(async () => {
                root.render(createElement(ActivityFiles, { files: [files[0]] }))
                await Promise.resolve()
            })
            expect([
                Object.is(container.querySelector('[data-value="all"]')?.getAttribute('aria-pressed'), 'true'),
                container.querySelectorAll('li')?.length
            ]).toStrictEqual([true, 1])
        } finally {
            await act(async () => {
                root.unmount()
                await Promise.resolve()
            })
            container.remove()
        }
    })
})
