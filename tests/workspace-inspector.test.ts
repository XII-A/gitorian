// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { WorkspaceInspector } from '../src/renderer/WorkspaceInspector'
import { sampleState } from '../src/renderer/workspace-sample'

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
    expect(renderInspector({ diff: '' }).textContent).toContain('No text diff for this activity.')
    expect(renderInspector({}).textContent).not.toContain('No text diff')
})

it('previews GitHub Markdown, file changes, and PR history in the details tab', () => {
    const state = sampleState('2026-10-05')
    const activity = {
        ...state.activities[8],
        kind: 'pr' as const,
        description:
            '## Summary\n\n**Retry uploads**\n\n- [x] Added coverage\n\n| File | Status |\n| --- | --- |\n| retry.ts | Updated |',
        filesLoaded: true,
        files: [{ name: 'src/renamed.ts', status: 'R100', previousName: 'src/old.ts' }],
        pullRequest: {
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
    expect(container.querySelector('[aria-label="Current status: Merged"]')).not.toBeNull()
})
