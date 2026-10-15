interface CursorPage<T> {
    results: T[]
    has_more: boolean
    next_cursor: string | null
}

/** Fetch the next page only after the consumer finishes processing this one.
 * @yields {T[]} The records from one page.
 */
export const cursorPages = async function* cursorPages<T>(
    read: (cursor: string | null) => Promise<CursorPage<T>>,
    cursor: string | null = null
): AsyncGenerator<T[]> {
    const page = await read(cursor)
    yield page.results
    if (page.has_more && page.next_cursor) {
        yield* cursorPages(read, page.next_cursor)
    }
}

export const numberedPages = async function* numberedPages<T>(
    read: (page: number) => Promise<T[]>,
    first: number,
    last: number
): AsyncGenerator<readonly [number, T[]]> {
    yield [first, await read(first)]
    if (first < last) {
        yield* numberedPages(read, first + 1, last)
    }
}
