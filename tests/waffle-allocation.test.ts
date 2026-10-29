import { formatWaffleShare } from '../src/renderer/components/arc/waffle-chart/waffle-format'
import { expect, it } from 'vitest'
import { allocateWaffleCells } from '../src/renderer/components/arc/waffle-chart/waffle-allocation'
it('keeps a tiny positive Other category visible without changing the whole', () => {
    const cells = allocateWaffleCells([{ value: 999 }, { value: 1 }, { value: 0 }], 1000, 100)
    expect(cells).toEqual([99, 1, 0])
    expect(cells.reduce((sum, count) => sum + count, 0)).toBe(100)
})
it('preserves all bounded positive categories under an extreme skew', () => {
    const data = [{ value: 1000000 }, ...Array.from({ length: 6 }, () => ({ value: 1 }))]
    const cells = allocateWaffleCells(data, 1000006, 100)
    expect(cells.every((count) => count > 0)).toBe(true)
    expect(cells.reduce((sum, count) => sum + count, 0)).toBe(100)
    expect(allocateWaffleCells([{ value: 0 }], 0, 100)).toEqual([0])
})

it('never labels a positive tiny share as zero and avoids unnecessary decimal zeroes', () => {
    expect(formatWaffleShare(0.0001, 1)).toBe('<0.1')
    expect(formatWaffleShare(0.4, 0)).toBe('<1')
    expect(formatWaffleShare(45, 1)).toBe('45')
    expect(formatWaffleShare(27.5, 1)).toBe('27.5')
    expect(formatWaffleShare(0, 1)).toBe('0')
})
