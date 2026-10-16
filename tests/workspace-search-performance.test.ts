// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Workspace } from '../src/renderer/Workspace'
import { sampleState } from '../src/renderer/workspace-sample'

const search = vi.hoisted(() => ({
    items: [] as { id: string; title: string }[],
    expand: undefined as ((expanded: boolean) => void) | undefined
}))
vi.mock('../src/renderer/components/arc/expanding-search/expanding-search', () => ({
    ExpandingSearch: (props: { items: typeof search.items; onExpandedChange: typeof search.expand }) => {
        search.items = props.items
        search.expand = props.onExpandedChange
        return null
    }
}))
vi.mock('../src/renderer/WorkspaceDraft', () => ({ WorkspaceDraft: () => null }))
vi.mock('../src/renderer/WorkspaceInspector', () => ({ WorkspaceInspector: () => null }))
vi.mock('../src/renderer/WorkspaceActivityList', () => ({ WorkspaceActivityList: () => null }))
vi.mock('../src/renderer/ActivityChart', () => ({ ActivityChart: () => null }))

it('builds full activity search metadata only while expanded and reuses it across unrelated refreshes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const state = sampleState('2026-10-05')
    const props = {
        state,
        initialWeek: '2026-10-05',
        notionConnected: false,
        error: '',
        run: vi.fn(),
        onBack: vi.fn(),
        onSources: vi.fn(),
        onSettings: vi.fn()
    }
    const render = async (value = state) => {
        await act(async () => {
            root.render(createElement(Workspace, { ...props, state: value }))
            await Promise.resolve()
        })
    }
    try {
        await render()
        expect(search.items).toHaveLength(0)
        await act(async () => {
            search.expand?.(true)
            await Promise.resolve()
        })
        expect(search.items.length).toBeGreaterThan(0)
        const before = search.items
        await render({ ...state, snapshotVersion: 10, acquisition: { source: { status: 'running' } } })
        expect(search.items).toBe(before)
        const activities = state.activities.map((item, index) => (index ? item : { ...item, title: 'Updated event' }))
        await render({ ...state, activities })
        expect(search.items.find((item) => item.id === activities[0].id)?.title).toBe('Updated event')
        await act(async () => {
            search.expand?.(false)
            await Promise.resolve()
        })
        expect(search.items).toHaveLength(0)
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        host.remove()
    }
})
