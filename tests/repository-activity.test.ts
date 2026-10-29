// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { RepositoryActivity } from '../src/renderer/RepositoryActivity'
import type { WaffleChartProps } from '../src/renderer/components/arc/waffle-chart/waffle-chart'

// Chart rendering is verified in Electron; this scenario owns the dev-only data override.
vi.mock('../src/renderer/components/arc/waffle-chart/waffle-chart', () => ({
    WaffleChart: ({ data }: WaffleChartProps) =>
        createElement(
            'ul',
            {},
            data.map((row) =>
                createElement('li', { key: row.key, 'data-color': row.color }, `${row.label}: ${row.value}`)
            )
        )
}))
const nativeAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
beforeAll(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
})
afterAll(() => {
    if (nativeAnimate) Object.defineProperty(Element.prototype, 'animate', nativeAnimate)
})
afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.useRealTimers()
})

it('previews sample repositories and returns to the real empty state', async () => {
    vi.stubEnv('DEV', true)
    const user = userEvent.setup()
    render(createElement(RepositoryActivity, { repositories: [], items: [], hasRepositories: false }))
    expect(screen.getByText('Connect a repository to load its activity.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show sample data' }))
    expect(screen.getByText('weekly-j: 18')).toBeVisible()
    expect(screen.getByText('docs-site: 4')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show real data' }))
    expect(screen.getByText('Connect a repository to load its activity.')).toBeVisible()
    expect(screen.queryByText('weekly-j: 18')).not.toBeInTheDocument()
})

it('keeps the sample override out of production', () => {
    vi.stubEnv('DEV', false)
    render(createElement(RepositoryActivity, { repositories: [], items: [], hasRepositories: false }))
    expect(screen.queryByRole('button', { name: 'Show sample data' })).not.toBeInTheDocument()
})
