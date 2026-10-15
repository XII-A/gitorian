/** A timer boundary that works in Node and the renderer, including fake timers. */
export const wait = (milliseconds: number): Promise<undefined> => {
    const { promise, resolve } = Promise.withResolvers<undefined>()
    setTimeout(resolve, milliseconds)
    return promise
}
