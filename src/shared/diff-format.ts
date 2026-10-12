/** Combined merge patches need to be reloaded as a two-way first-parent comparison. */
export function isCombinedDiff(diff: string | undefined): boolean {
    return diff !== undefined && /^diff --(?:cc|combined) /m.test(diff)
}
