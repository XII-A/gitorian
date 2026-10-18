/** Copy mutable JSON state while retaining equal immutable subtrees from the previous snapshot. */
export function shareSnapshot<T>(previous: T | undefined, next: T): T {
    if (Object.is(previous, next)) return previous as T
    if (!next || typeof next !== 'object') return next
    if (Array.isArray(next)) {
        const before: unknown[] = Array.isArray(previous) ? previous : []
        if (
            Array.isArray(previous) &&
            before.length === next.length &&
            next.every((value, index) => Object.is(value, before[index]))
        )
            return previous as T
        let result: unknown[] | undefined = Array.isArray(previous) ? undefined : []
        for (let index = 0; index < next.length; index++) {
            const value = shareSnapshot(before[index], next[index] as unknown)
            if (!result && (index >= before.length || value !== before[index])) result = before.slice(0, index)
            result?.push(value)
        }
        return (result ?? (before.length === next.length ? previous : before.slice(0, next.length))) as T
    }
    const before =
        previous && typeof previous === 'object' && !Array.isArray(previous)
            ? (previous as Record<string, unknown>)
            : undefined
    const after = next as Record<string, unknown>
    let result: Record<string, unknown> | undefined = before ? undefined : {}
    for (const key of Object.keys(after)) {
        const value = shareSnapshot(before?.[key], after[key])
        if (!result && (!Object.hasOwn(before!, key) || value !== before![key])) result = { ...before }
        if (result) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true })
    }
    if (before)
        for (const key of Object.keys(before)) {
            if (!Object.hasOwn(after, key)) {
                result ??= { ...before }
                Reflect.deleteProperty(result, key)
            }
        }
    return (result ?? previous) as T
}
