/** Combined merge patches need to be reloaded as a two-way first-parent comparison. */
export const isCombinedDiff = (diff: string | undefined): boolean =>
    diff !== undefined && /^diff --(?:cc|combined) /mu.test(diff)
