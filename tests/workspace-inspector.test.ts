// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceInspector } from '../src/renderer/workspace-inspector'
import { sampleState } from '../src/renderer/workspace-sample'
import { required } from '../src/shared/required'

const renderInspector = (options: { error?: string; loading?: boolean; diff?: string }) => {
    const state = sampleState('2026-10-05')
    const [activity] = state.activities
    state.diffs = {}
    if (options.diff !== undefined) {
        state.diffs[activity.id] = options.diff
    }
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
        createElement(WorkspaceInspector, {
            activity,
            error: options.error,
            loading: options.loading,
            onCite: vi.fn<(...args: unknown[]) => void>(),
            onInspect: vi.fn<(...args: unknown[]) => void>(),
            run: vi.fn<(...args: unknown[]) => Promise<undefined>>(),
            state
        })
    )
    return container
}

describe('workspace-inspector', () => {
    it('renders an initial diff failure only inside the diff tab without diagnostics or an empty-diff claim', () => {
        const container = renderInspector({ error: 'HTTP 401 Bad credentials internal request payload' })
        const panel = required(container.querySelector('[role="tabpanel"]'))
        expect([
            panel.textContent?.includes("Changes couldn't be loaded"),
            panel.textContent?.includes('Reconnect in Settings'),
            panel.textContent?.includes('Retry'),
            container.textContent?.includes('No text diff'),
            container.textContent?.includes('internal request payload'),
            container.querySelector('details, summary') === null,
            panel.querySelector('[data-variant="plain"]') === null
        ]).toStrictEqual([true, true, true, false, false, true, false])
    })

    it('keeps loading distinct from an empty result', () => {
        const container = renderInspector({ loading: true })
        expect([
            container.querySelector('output[aria-label="Loading changes"][aria-busy="true"]') === null,
            container.querySelector('.ws-diff-tools') === null,
            container.textContent?.includes('No text diff')
        ]).toStrictEqual([false, false, false])
    })

    it('preserves cached changes after a failed refresh', () => {
        const container = renderInspector({ diff: 'Cached file content', error: 'Network error' })
        expect([
            container.textContent?.includes('Showing cached changes'),
            container.textContent?.includes('Cached file content'),
            container.textContent?.includes("Changes couldn't be loaded")
        ]).toStrictEqual([true, true, false])
    })

    it('shows an empty-diff message only for a confirmed empty response', () => {
        const empty = renderInspector({ diff: '' })
        expect([
            Object.is(empty.querySelector('h3')?.textContent, 'No text diff'),
            empty.querySelector('[data-variant="plain"]') === null,
            empty.querySelector('[aria-label="Diff status"]') === null,
            empty.textContent?.includes('Reviews and metadata updates may not include code changes.'),
            renderInspector({}).textContent?.includes('No text diff')
        ]).toStrictEqual([true, false, false, true, false])
    })

    it('previews GitHub Markdown, file changes, and PR history in the details tab', () => {
        const state = sampleState('2026-10-05')
        const activity = {
            ...state.activities[8],
            description:
                '## Summary\n\n**Retry uploads**\n\n- [x] Added coverage\n\n| File | Status |\n| --- | --- |\n| retry.ts | Updated |',
            files: [{ name: 'src/renamed.ts', previousName: 'src/old.ts', status: 'R100' }],
            filesLoaded: true,
            kind: 'pr' as const,
            pullRequest: {
                commitDates: [],
                mergedAt: '2026-10-09T15:00:00Z',
                openedAt: state.activities[8].date,
                status: 'merged' as const
            }
        }
        const container = document.createElement('div')
        container.innerHTML = renderToStaticMarkup(
            createElement(WorkspaceInspector, {
                activity,
                initialTab: 'details',
                onCite: vi.fn<(...args: unknown[]) => void>(),
                onInspect: vi.fn<(...args: unknown[]) => void>(),
                run: vi.fn<(...args: unknown[]) => Promise<undefined>>(),
                state
            })
        )
        expect([
            Object.is(container.querySelector('.hub-detail-markdown strong')?.textContent, 'Retry uploads'),
            container.querySelector('.hub-detail-markdown table') === null,
            container.querySelector('.hub-detail-markdown input[type="checkbox"]') === null,
            container
                .querySelector('[aria-label="Changed files ledger"]')
                ?.textContent?.includes('src/old.ts → src/renamed.ts'),
            container
                .querySelector('[aria-label="Pull request lifecycle"]')
                ?.textContent?.includes('Merged pull request'),
            Object.is(container.querySelector('.hub-detail-meta time')?.getAttribute('datetime'), activity.date),
            container.querySelector('[aria-label="Current status: Merged"]') === null
        ]).toStrictEqual([true, false, false, true, true, true, false])
    })
})
