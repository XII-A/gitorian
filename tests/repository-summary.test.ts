import { expect, it } from 'vitest'
import { hubActivity, hubRepository, largeHubFixture } from './hub-fixtures'
import { summarizeRepositoryActivity } from '../src/renderer/repository-markers'
it('keeps the complete identity map while bounding chart categories and preserving totals', () => {
    const fixture = largeHubFixture()
    const summary = summarizeRepositoryActivity(fixture.repositories, fixture.activities)
    expect(summary.entries).toHaveLength(256)
    expect(summary.chart).toHaveLength(7)
    expect(summary.chart.reduce((sum, row) => sum + row.value, 0)).toBe(1024)
    expect(summary.chart.slice(0, 6).every((row) => row.value === 4)).toBe(true)
    expect(summary.chart.at(-1)).toMatchObject({ label: 'Other (250)', value: 1000 })
    expect(summary.entries.filter((row) => row.group === 'repository-other')).toHaveLength(250)
})
it('disambiguates equal names with their repository location', () => {
    const summary = summarizeRepositoryActivity(
        [hubRepository(0, { name: 'api' }), hubRepository(1, { name: 'api' })],
        [hubActivity(0), hubActivity(1, { repositoryId: 'repo-1' })]
    )
    const duplicates = summary.entries.filter((row) => row.name === 'api')
    expect(duplicates).toHaveLength(2)
    expect(new Set(duplicates.map((row) => row.label)).size).toBe(2)
    expect(summary.chart.reduce((sum, row) => sum + row.value, 0)).toBe(summary.total)
})
