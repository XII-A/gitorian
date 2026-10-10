// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ActivityRow } from '../src/renderer/ActivityRow'
import { sampleState } from '../src/renderer/workspace-sample'

describe('activity row pull request references', () => {
    it.each(['0ae81df3-9fec-41d5-8c51-42132f609746:pr:602', 'sample/pr/602'])(
        'shows the PR number without the internal ID for %s',
        (prId) => {
            const activity = {
                ...sampleState('2026-10-05').activities[0],
                kind: 'pr' as const,
                prId,
                title: '#602 Release background survey exports and organization integration isolation'
            }
            const container = document.createElement('div')
            container.innerHTML = renderToStaticMarkup(
                createElement(ActivityRow, { activity, repositoryName: 'gitea-slick-erp' })
            )
            expect(container.querySelector('.activity-row-reference')?.textContent).toBe('#602')
            expect(container.querySelector('.activity-row-title')?.textContent).toBe(activity.title)
            expect(container.textContent).not.toContain(prId)
        }
    )
})
