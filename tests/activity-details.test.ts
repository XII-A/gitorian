// @vitest-environment happy-dom
import { ActivityRow } from '../src/renderer/ActivityRow'
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityDescription } from '../src/renderer/ActivityDescription'
import { ActivityFiles } from '../src/renderer/ActivityFiles'
import { PullRequestLifecycle, PullRequestStatus } from '../src/renderer/PullRequestLifecycle'
import { Timeline } from '../src/renderer/components/arc/timeline/timeline'
import timelineStyles from '../src/renderer/components/arc/timeline/timeline.module.css'
import { activityBranches, markdownUrl, orderedFiles } from '../src/renderer/activity-details'
import { sampleState } from '../src/renderer/workspace-sample'

const state = sampleState('2026-10-05')
const activity = { ...state.activities[8], url: 'https://github.com/example/project/pull/12' }
const repository = { ...state.repositories[0], remote: 'https://github.com/example/project.git', base: 'main' }
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(element)
    return container
}

describe('pull request lifecycle presentation', () => {
    it('shows lifecycle milestones newest first with timezone-aware accessible times', () => {
        const pull = {
            ...activity,
            changeRequest: {
                status: 'merged' as const,
                openedAt: '2026-10-05T10:00:00Z',
                commitDates: ['2026-10-06T10:00:00Z', '2026-10-08T10:00:00Z'],
                closedAt: '2026-10-09T10:00:00Z',
                mergedAt: '2026-10-09T10:00:00Z'
            }
        }
        const container = render(
            createElement(PullRequestLifecycle, {
                activity: pull,
                activities: [pull],
                timezone: 'Europe/Istanbul',
                refreshedAt: '2026-10-11T12:00:00Z'
            })
        )
        expect([...container.querySelectorAll('li')].map((row) => row.textContent)).toEqual([
            expect.stringContaining('Merged pull request'),
            expect.stringContaining('Latest commit'),
            expect.stringContaining('Opened pull request')
        ])
        expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-09T10:00:00.000Z')
        expect(container.querySelector('time')?.getAttribute('title')).toContain('1:00 PM')
        expect(container.querySelector('time')?.textContent).toContain('Oct 9, 1:00 PM')
        expect(container.querySelectorAll('[role="heading"]')).toHaveLength(0)
        expect(container.querySelectorAll('ol')).toHaveLength(1)
        expect(container.querySelectorAll(`.${timelineStyles.segment}`)).toHaveLength(2)
        expect(container.textContent).not.toContain('update')
        expect(container.textContent).not.toContain('Closed without merging')
    })
    it('shows closed without merging and avoids duplicated opening/commit timestamps', () => {
        const pull = {
            ...activity,
            changeRequest: {
                status: 'closed' as const,
                openedAt: activity.date,
                commitDates: [activity.date],
                closedAt: '2026-10-09T10:00:00Z'
            }
        }
        const container = render(
            createElement(PullRequestLifecycle, {
                activity: pull,
                activities: [pull],
                timezone: 'UTC'
            })
        )
        expect(container.querySelectorAll('li')).toHaveLength(2)
        expect(container.textContent).toContain('Closed without merging')
    })
    it('keeps missing legacy status honest and provides a history recovery hint', () => {
        const container = render(createElement(PullRequestStatus, { activity, activities: [activity] }))
        expect(container.textContent).toBe('Status unavailable')
        const history = render(
            createElement(PullRequestLifecycle, { activity, activities: [activity], timezone: 'UTC' })
        )
        expect(history.textContent).toContain('Refresh activity')
    })
})

describe('timeline date grouping', () => {
    const events = [
        { id: 'opened', at: '2026-10-05T10:00:00Z', title: 'Opened pull request' },
        { id: 'merged', at: '2026-10-09T10:00:00Z', title: 'Merged pull request' }
    ]
    const props = { events, now: Date.parse('2026-10-11T12:00:00Z'), label: 'History', timeZone: 'Europe/Istanbul' }
    it('connects Monday and Friday in a single list with dates instead of day headings and counts', () => {
        const container = render(createElement(Timeline, { ...props, groupByDay: false }))
        expect(container.querySelectorAll('ol')).toHaveLength(1)
        expect(container.querySelectorAll('li')).toHaveLength(2)
        expect(container.querySelectorAll(`.${timelineStyles.segment}`)).toHaveLength(1)
        expect(
            [...container.querySelectorAll('time')].map((time) => time.querySelector('[aria-hidden]')?.textContent)
        ).toEqual(['Oct 9, 1:00 PM', 'Oct 5, 1:00 PM'])
        expect(container.querySelector('[role="heading"]')).toBeNull()
        expect(container.querySelector('[aria-labelledby]')).toBeNull()
        expect(container.textContent).not.toContain('update')
    })
    it('preserves grouped feed headings and counts by default', () => {
        const container = render(createElement(Timeline, props))
        expect(container.querySelectorAll('ol')).toHaveLength(2)
        expect(container.querySelectorAll('[role="heading"]')).toHaveLength(2)
        expect(container.querySelectorAll(`.${timelineStyles.segment}`)).toHaveLength(0)
        expect(container.textContent).toContain('1 update')
        expect(container.querySelector('time')?.querySelector('[aria-hidden]')?.textContent).toBe('1:00 PM')
    })
    it('keeps the year visible for older events, using the display timezone at year boundaries', () => {
        const container = render(
            createElement(Timeline, {
                ...props,
                groupByDay: false,
                events: [
                    { id: 'older', at: '2025-10-05T10:00:00Z', title: 'Older event' },
                    { id: 'boundary', at: '2025-12-31T23:30:00Z', title: 'New year event' }
                ]
            })
        )
        expect(
            [...container.querySelectorAll('time')].map((time) => time.querySelector('[aria-hidden]')?.textContent)
        ).toEqual(['Jan 1, 2:30 AM', 'Oct 5, 2025, 1:00 PM'])
    })
})

describe('activity branch context', () => {
    const commit = {
        ...activity,
        kind: 'commit' as const,
        sha: 'abc123',
        branches: ['development', 'feature/work', 'origin/development']
    }
    it('uses one containing branch without claiming that it is the original branch', () => {
        expect(activityBranches(commit)).toEqual({
            primary: 'development',
            remaining: ['feature/work', 'origin/development'],
            label: 'Found on'
        })
    })
    it('uses a matching PR source branch and excludes another repository with the same head', () => {
        const pull = { ...activity, head: commit.sha, branches: ['feature/work'] }
        const unrelated = { ...pull, repositoryId: 'another-repository', branches: ['other/work'] }
        expect(activityBranches(commit, [pull, unrelated])).toEqual({
            primary: 'feature/work',
            remaining: ['development', 'origin/development'],
            label: 'Source branch'
        })
    })
    it('does not guess between conflicting PR sources or absent commit hashes', () => {
        const pull = { ...activity, head: commit.sha, branches: ['feature/work'] }
        expect(activityBranches(commit, [pull, { ...pull, branches: ['another/work'] }]).label).toBe('Found on')
        expect(activityBranches({ ...commit, sha: undefined }, [pull]).label).toBe('Found on')
    })
    it('keeps PR source context and counts unique remaining branches without altering metadata', () => {
        const pull = { ...activity, branches: ['feature/work', 'development', 'development'] }
        expect(activityBranches(pull)).toEqual({
            primary: 'feature/work',
            remaining: ['development'],
            label: 'Source branch'
        })
        expect(pull.branches).toHaveLength(3)
        expect(activityBranches({ ...commit, branches: [] }).primary).toBeUndefined()
    })
})

describe('activity descriptions', () => {
    it('renders GitHub Markdown with headings, code, tasks, tables, and external links', () => {
        const description =
            '## Summary\n\nKeep **pending uploads** in `storage`.\n\n- [x] Tested\n- [ ] Follow up\n\n| Before | After |\n| --- | --- |\n| Lost | Saved |\n\n```ts\nconst safe = true\n```\n\n[Details](https://github.com/example/project/pull/12)'
        const container = render(
            createElement(ActivityDescription, { activity: { ...activity, description }, repository })
        )
        expect(container.querySelector('h4')?.textContent).toBe('Summary')
        expect(container.querySelector('strong')?.textContent).toBe('pending uploads')
        expect(container.querySelectorAll('input:disabled')).toHaveLength(2)
        expect(container.querySelector('input:checked')).not.toBeNull()
        expect(container.querySelector('table td')?.textContent).toBe('Lost')
        expect(container.querySelector('pre code')?.textContent).toContain('const safe = true')
        expect(container.querySelector('a')?.getAttribute('target')).toBe('_blank')
    })
    it('does not execute raw HTML or unsafe link and image schemes', () => {
        const description =
            '<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![unsafe image](data:text/html,bad)'
        const container = render(createElement(ActivityDescription, { activity: { ...activity, description } }))
        expect(container.querySelector('script')).toBeNull()
        expect(container.querySelector('a')).toBeNull()
        expect(container.querySelector('img')).toBeNull()
        expect(container.textContent).toContain('unsafe')
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
        expect(block?.closest('[role="region"]')?.getAttribute('aria-label')).toBe('Diff code block')
        expect(block?.textContent).toBe(source)
        expect(block?.querySelectorAll('[data-diff-line="added"]')).toHaveLength(2)
        expect(block?.querySelectorAll('[data-diff-line="removed"]')).toHaveLength(1)
        expect(block?.querySelectorAll('[data-diff-line="context"]')).toHaveLength(5)
        expect(block?.querySelector('script')).toBeNull()
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
        expect(container.querySelector('.hub-detail-diff')).toBeNull()
        expect(container.querySelector('pre code')?.textContent).toBe('- ordinary text\n+ ordinary text\n')
        expect(container.querySelector('li')?.textContent).toBe('A list item')
        expect(container.querySelector('p code')?.textContent).toBe('+ inline')
    })
    it('resolves repository links, PR fragments, and refuses credentialed URLs', () => {
        expect(markdownUrl('README.md', activity, repository)).toBe(
            'https://github.com/example/project/blob/main/README.md'
        )
        expect(markdownUrl('#discussion', activity, repository)).toBe(`${activity.url}#discussion`)
        expect(markdownUrl('https://user:pass@github.com/example', activity, repository)).toBe('')
        expect(markdownUrl('javascript:alert(1)', activity, repository)).toBe('')
        const source = {
            provider: 'gitlab' as const,
            host: 'gitlab.com' as const,
            path: 'team/sub/project',
            eventId: '1',
            configuration: '',
            accountId: 'account',
            sessionGeneration: 1
        }
        expect(markdownUrl('docs/guide.md', { ...activity, base: 'main', remoteSource: source }, repository)).toBe(
            'https://gitlab.com/team/sub/project/-/blob/main/docs/guide.md'
        )
        expect(
            markdownUrl('README.md', activity, { ...repository, remote: 'git@github.com:example/project.git' })
        ).toBe('https://github.com/example/project/blob/main/README.md')
    })
    it('keeps commit messages literal instead of interpreting their punctuation as Markdown', () => {
        const container = render(
            createElement(ActivityDescription, {
                activity: { ...activity, kind: 'commit', description: 'Fix *glob* matching\n\n#602' }
            })
        )
        expect(container.querySelector('em')).toBeNull()
        expect(container.textContent).toBe('Fix *glob* matching\n\n#602')
    })
})

describe('activity files', () => {
    it('sorts deleted files first without mutating source data and shows rename paths and totals', () => {
        const files = [
            { name: 'src/z.ts', status: 'M' },
            { name: 'src/new.ts', status: 'R100', previousName: 'src/old.ts' },
            { name: 'src/gone.ts', status: 'removed' },
            { name: 'src/added.ts', status: 'added' }
        ]
        expect(orderedFiles(files).map((file) => file.name)).toEqual([
            'src/gone.ts',
            'src/added.ts',
            'src/new.ts',
            'src/z.ts'
        ])
        expect(files[0].name).toBe('src/z.ts')
        const container = render(createElement(ActivityFiles, { files }))
        expect(container.querySelector('li')?.getAttribute('data-change')).toBe('deleted')
        expect(container.querySelector('[data-change="renamed"] .hub-detail-file-directory')?.textContent).toBe(
            'src/old.ts → src/new.ts'
        )
        expect(container.querySelector('[data-value="deleted"]')?.textContent).toBe('Deleted1')
        expect(container.querySelector('li .hub-sr-only')?.textContent).toBe('Deleted')
    })
    it('displays legacy local rename snapshots using old and new paths', () => {
        const container = render(
            createElement(ActivityFiles, { files: [{ name: 'old/file.ts\tnew/file.ts', status: 'R100' }] })
        )
        expect(container.querySelector('.hub-detail-file-name')?.textContent).toBe('file.ts')
        expect(container.querySelector('.hub-detail-file-directory')?.textContent).toBe('old/file.ts → new/file.ts')
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
            const modified = container.querySelector<HTMLButtonElement>('[data-value="modified"]')!
            expect(modified.textContent).toBe('Modified2')
            expect(container.querySelector('[data-value="renamed"]')).toBeNull()
            await act(async () => {
                modified.click()
                await Promise.resolve()
            })
            expect(modified.getAttribute('aria-pressed')).toBe('true')
            expect(container.querySelectorAll('li')).toHaveLength(2)
            expect(container.querySelector('li[data-change="added"]')).toBeNull()
            await act(async () => {
                modified.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
                await Promise.resolve()
            })
            expect(container.querySelector('[data-value="all"]')?.getAttribute('aria-pressed')).toBe('true')
            expect(container.querySelectorAll('li')).toHaveLength(4)
            expect(container.querySelector('li')?.getAttribute('data-change')).toBe('deleted')
            await act(async () => {
                container.querySelector<HTMLButtonElement>('[data-value="deleted"]')!.click()
                await Promise.resolve()
            })
            await act(async () => {
                root.render(createElement(ActivityFiles, { files: [files[0]] }))
                await Promise.resolve()
            })
            expect(container.querySelector('[data-value="all"]')?.getAttribute('aria-pressed')).toBe('true')
            expect(container.querySelectorAll('li')).toHaveLength(1)
        } finally {
            await act(async () => {
                root.unmount()
                await Promise.resolve()
            })
            container.remove()
        }
    })
})

describe('activity row pull request references', () => {
    it.each(['0ae81df3-9fec-41d5-8c51-42132f609746:pr:602', 'sample/pr/602'])(
        'shows the PR number without the internal ID for %s',
        (changeRequestId) => {
            const activity = {
                ...sampleState('2026-10-05').activities[0],
                kind: 'change-request' as const,
                changeRequestId,
                title: '#602 Release background survey exports and organization integration isolation'
            }
            const container = document.createElement('div')
            container.innerHTML = renderToStaticMarkup(
                createElement(ActivityRow, { activity, repositoryName: 'example-project' })
            )
            expect(container.querySelector('.activity-row-reference')?.textContent).toBe('#602')
            expect(container.querySelector('.activity-row-title')?.textContent).toBe(activity.title)
            expect(container.textContent).not.toContain(changeRequestId)
        }
    )
})
