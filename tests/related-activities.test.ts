// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RelatedActivities } from '../src/renderer/related-activities'
import { sampleState } from '../src/renderer/workspace-sample'

describe('related-activities', () => {
    it('mounts a bounded initial window of 3,000 activities with their full list positions', () => {
        const [activity] = sampleState('2026-10-05').activities
        const activities = Array.from({ length: 3000 }, (_, index) => ({ ...activity, id: `related-${index}` }))
        const container = document.createElement('div')
        container.innerHTML = renderToStaticMarkup(
            createElement(RelatedActivities, { activities, repositoryName: 'Project' })
        )
        const rows = container.querySelectorAll('.activity-row')
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.length).toBeLessThan(20)
        expect([
            Object.is(container.querySelector('li')?.getAttribute('aria-setsize'), '3000'),
            Object.is(container.querySelector('li')?.getAttribute('aria-posinset'), '1')
        ]).toStrictEqual([true, true])
    })

    it('explains an empty relation without reserving a long virtual scroll area', () => {
        const container = document.createElement('div')
        container.innerHTML = renderToStaticMarkup(
            createElement(RelatedActivities, { activities: [], repositoryName: 'Project' })
        )
        expect([
            Object.is(container.querySelector('h3')?.textContent, 'No related activity'),
            container.textContent?.includes('No other captured activity shares this branch or pull request.'),
            container.querySelector('[data-variant="plain"]') === null,
            container.querySelector('[aria-label="Related activity"]') === null,
            container.querySelector('.ws-related-space') === null
        ]).toStrictEqual([true, true, false, false, true])
    })
})
