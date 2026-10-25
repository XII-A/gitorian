import { expect, it } from 'vitest'
import { summarizeChanges } from '../src/shared/change-statistics'

it('partitions all text changes once, with eval/test paths taking precedence over source and docs', () => {
    const result = summarizeChanges([
        { name: 'src/runtime.ts', status: 'M', lineStats: { additions: 55, deletions: 7 } },
        { name: 'src/runtime.test.ts', status: 'M', lineStats: { additions: 77, deletions: 1 } },
        { name: 'evals/scoring.test.ts', status: 'A', lineStats: { additions: 503, deletions: 36 } },
        { name: 'docs/guide.md', status: 'A', lineStats: { additions: 10, deletions: 0 } },
        { name: 'package.json', status: 'M', lineStats: { additions: 2, deletions: 1 } },
        {
            name: 'src/contest.ts',
            previousName: 'tests/old.ts',
            status: 'R100',
            lineStats: { additions: 0, deletions: 0 }
        },
        { name: 'image.png', status: 'A', lineStats: null }
    ])
    expect(result.total).toEqual({ additions: 647, deletions: 45 })
    expect(result.groups.map(({ category, additions, deletions }) => [category, additions, deletions])).toEqual([
        ['Runtime', 55, 7],
        ['Tests', 77, 1],
        ['Evals', 503, 36],
        ['Docs', 10, 0],
        ['Other', 2, 1]
    ])
    expect(result.binaryFiles).toBe(1)
})

it('distinguishes unavailable old metadata, binary-only changes, and confirmed zero changes', () => {
    expect(summarizeChanges([{ name: 'old.ts', status: 'M' }]).total).toBeUndefined()
    expect(summarizeChanges([{ name: 'asset.png', status: 'M', lineStats: null }]).total).toEqual({
        additions: 0,
        deletions: 0
    })
    expect(summarizeChanges([]).total).toEqual({ additions: 0, deletions: 0 })
})
