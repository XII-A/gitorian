// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityRow } from '../src/renderer/activity-row'
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
            expect([
                Object.is(container.querySelector('.activity-row-reference')?.textContent, '#602'),
                Object.is(container.querySelector('.activity-row-title')?.textContent, activity.title),
                container.textContent?.includes(prId)
            ]).toStrictEqual([true, true, false])
        }
    )
})
