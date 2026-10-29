/** Quantize a bounded part-to-whole chart, retaining a cell for every positive category when capacity permits. */
export function allocateWaffleCells(data: readonly { value: number }[], total: number, cells: number): number[] {
    if (total <= 0) return data.map(() => 0)
    const exact = data.map((item) => (Math.max(0, item.value) / total) * cells)
    const counts = exact.map(Math.floor)
    let left = cells - counts.reduce((sum, count) => sum + count, 0)
    const order = exact
        .map((value, index) => ({ index, rest: value - Math.floor(value) }))
        .sort((a, b) => b.rest - a.rest)
    for (let k = 0; left > 0 && k < order.length; k++, left--) counts[order[k].index]++
    // The chart remains quantized; labels retain raw shares instead of pretending a cell is an exact percentage.
    for (let index = 0; index < data.length; index++) {
        if (data[index].value <= 0 || counts[index]) continue
        const donor = counts.reduce((best, count, i) => (count > counts[best] ? i : best), 0)
        if (counts[donor] > 1) {
            counts[donor]--
            counts[index]++
        }
    }
    return counts
}
