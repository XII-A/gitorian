// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ActivityDescription } from '../src/renderer/ActivityDescription'
import { hubActivity } from './hub-fixtures'
afterEach(cleanup)
it('renders PR emoji shortcodes in prose while preserving code and link destinations', () => {
    const { container } = render(
        createElement(ActivityDescription, {
            activity: hubActivity(0, {
                kind: 'change-request',
                description:
                    ':rocket: **:tada:** :unknown: \u{1f680} [launch :+1:](https://example.com/:rocket:)\n\n`:rocket:`\n\n```ts\nconst icon = ":tada:"\n```'
            })
        })
    )
    expect(container.textContent).toContain('\u{1f680} \u{1f389} :unknown: \u{1f680} launch \u{1f44d}')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/:rocket:')
    expect(container.querySelector('code')?.textContent).toBe(':rocket:')
    expect(container.querySelector('pre')?.textContent).toContain(':tada:')
})
it('renders provider title shortcodes without changing commit subjects', async () => {
    const { ActivityRow } = await import('../src/renderer/ActivityRow')
    const { container } = render(
        createElement(ActivityRow, {
            activity: hubActivity(0, { kind: 'change-request', title: ':rocket: Ship :tada:' }),
            repositoryName: 'Project'
        })
    )
    expect(container.textContent).toContain('\u{1f680} Ship \u{1f389}')
    cleanup()
    const commit = render(
        createElement(ActivityRow, {
            activity: hubActivity(0, { title: ':rocket: literal commit' }),
            repositoryName: 'Project'
        })
    )
    expect(commit.container.textContent).toContain(':rocket: literal commit')
})
