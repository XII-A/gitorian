// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RelatedActivities } from '../src/renderer/RelatedActivities'
import { sampleState } from '../src/renderer/workspace-sample'

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
    expect(container.textContent).toContain('No other captured activity shares this branch or pull request.')
    expect(container.querySelector('[data-variant="plain"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Related activity"]')).not.toBeNull()
    expect(container.querySelector('.ws-related-space')).toBeNull()
})
