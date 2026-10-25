/** Combined merge patches need to be reloaded as a two-way first-parent comparison. */
export function isCombinedDiff(diff: string | undefined): boolean {
    return diff !== undefined && /^diff --(?:cc|combined) /m.test(diff)
}

/** gitdiff-parser can consume binary markers as metadata without setting isBinary. */
export function markBinaryDiffs<T extends { isBinary?: boolean }>(files: T[], text: string): T[] {
    const sections = text.split(/^diff --git /m).slice(1)
    return files.map((file, index) =>
        /^(Binary files .* differ|GIT binary patch)\r?$/m.test(sections[index] ?? '')
            ? { ...file, isBinary: true }
            : file
    )
}
