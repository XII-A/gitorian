/** Validate a value required by an invariant at a boundary. */
export const required = <T>(value: T | null | undefined): T => {
    if (value === undefined || value === null) {
        throw new TypeError('Expected a required value')
    }
    return value
}
