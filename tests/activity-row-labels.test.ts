// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ActivityRow } from '../src/renderer/ActivityRow'
import { hubActivity } from './hub-fixtures'
afterEach(cleanup)
it('keeps an imported record with an empty title identifiable', () => {
    const activity = hubActivity(0, { title: '   ' })
    render(createElement(ActivityRow, { activity, repositoryName: 'J' }))
    expect(screen.getByRole('button').textContent).toContain('Untitled activity')
})
