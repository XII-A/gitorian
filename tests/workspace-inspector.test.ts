// @vitest-environment happy-dom
import { RelatedActivities } from '../src/renderer/RelatedActivities'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { WorkspaceInspector } from '../src/renderer/WorkspaceInspector'
import { sampleState } from './workspace-fixture'

function renderInspector(options: { error?: string; loading?: boolean; diff?: string }) {
    const state = sampleState('2026-10-05')
    const activity = state.activities[0]
    state.diffs = {}
    if (options.diff !== undefined) state.diffs[activity.id] = options.diff
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
        createElement(WorkspaceInspector, {
            state,
            activity,
            initialTab: 'diff',
            run: vi.fn(),
            onCite: vi.fn(),
            onInspect: vi.fn(),
            error: options.error,
            loading: options.loading
        })
    )
    return container
}

it('renders an initial diff failure only inside the diff tab without diagnostics or an empty-diff claim', () => {
    const container = renderInspector({ error: 'HTTP 401 Bad credentials internal request payload' })
    const panel = container.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("Changes couldn't be loaded")
    expect(panel.textContent).toContain('Reconnect in Settings')
    expect(panel.textContent).toContain('Retry')
    expect(container.textContent).not.toContain('No text diff')
    expect(container.textContent).not.toContain('internal request payload')
    expect(container.querySelector('details, summary')).toBeNull()
    expect(panel.querySelector('[data-variant="plain"]')).not.toBeNull()
})

it('keeps loading distinct from an empty result', () => {
    const container = renderInspector({ loading: true })
    expect(container.querySelector('[role="status"][aria-label="Loading changes"][aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('.ws-diff-tools')).not.toBeNull()
    expect(container.textContent).not.toContain('No text diff')
})

it('preserves cached changes after a failed refresh', () => {
    const container = renderInspector({ diff: 'Cached file content', error: 'Network error' })
    expect(container.textContent).toContain('Showing cached changes')
    expect(container.textContent).toContain('Cached file content')
    expect(container.textContent).not.toContain("Changes couldn't be loaded")
})

it('shows an empty-diff message only for a confirmed empty response', () => {
    const empty = renderInspector({ diff: '' })
    expect(empty.querySelector('h3')?.textContent).toBe('No text diff')
    expect(empty.querySelector('[data-variant="plain"]')).not.toBeNull()
    expect(empty.querySelector('[aria-label="Diff status"]')).not.toBeNull()
    expect(empty.textContent).toContain('Reviews and metadata updates may not include code changes.')
    expect(renderInspector({}).textContent).not.toContain('No text diff')
})

it('previews GitHub Markdown, file changes, and PR history in the details tab', () => {
    const state = sampleState('2026-10-05')
    const activity = {
        ...state.activities[8],
        kind: 'change-request' as const,
        description:
            '## Summary\n\n**Retry uploads**\n\n- [x] Added coverage\n\n| File | Status |\n| --- | --- |\n| retry.ts | Updated |',
        filesLoaded: true,
        files: [{ name: 'src/renamed.ts', status: 'R100', previousName: 'src/old.ts' }],
        changeRequest: {
            status: 'merged' as const,
            openedAt: state.activities[8].date,
            commitDates: [],
            mergedAt: '2026-10-09T15:00:00Z'
        }
    }
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
        createElement(WorkspaceInspector, {
            state,
            activity,
            initialTab: 'details',
            run: vi.fn(),
            onCite: vi.fn(),
            onInspect: vi.fn()
        })
    )
    expect(container.querySelector('.hub-detail-markdown strong')?.textContent).toBe('Retry uploads')
    expect(container.querySelector('.hub-detail-markdown table')).not.toBeNull()
    expect(container.querySelector('.hub-detail-markdown input[type="checkbox"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Changed files ledger"]')?.textContent).toContain(
        'src/old.ts → src/renamed.ts'
    )
    expect(container.querySelector('[aria-label="Pull request lifecycle"]')?.textContent).toContain(
        'Merged pull request'
    )
    expect(container.querySelector('.hub-detail-meta time')?.getAttribute('datetime')).toBe(activity.date)
    const heading = container.querySelector('.ws-inspector-header h2')!
    expect(heading?.textContent).toBe(activity.title)
    expect(container.querySelector('.ws-inspector')?.getAttribute('aria-labelledby')).toBe(heading?.id)
    expect(container.querySelector('.ws-details-content h2')).toBeNull()
    expect(container.querySelector('.ws-inspector-header [aria-label="Current status: Merged"]')).not.toBeNull()
})

it('mounts a bounded initial window of 3,000 activities with their full list positions', () => {
    const activity = sampleState('2026-10-05').activities[0]
    const activities = Array.from({ length: 3000 }, (_, index) => ({ ...activity, id: `related-${index}` }))
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
        createElement(RelatedActivities, { activities, repositoryName: 'Project' })
    )
    const rows = container.querySelectorAll('.activity-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(20)
    expect(container.querySelector('li')?.getAttribute('aria-setsize')).toBe('3000')
    expect(container.querySelector('li')?.getAttribute('aria-posinset')).toBe('1')
})

it('explains an empty relation without reserving a long virtual scroll area', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
        createElement(RelatedActivities, { activities: [], repositoryName: 'Project' })
    )
    expect(container.querySelector('h3')?.textContent).toBe('No related activity')
    expect(container.textContent).toContain('No other captured activity shares this branch or request.')
    expect(container.querySelector('[data-variant="plain"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Related activity"]')).not.toBeNull()
    expect(container.querySelector('.ws-related-space')).toBeNull()
})
