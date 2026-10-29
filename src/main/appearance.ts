import { readFile, writeFile, rename } from 'node:fs/promises'
import { appearanceSchema, defaultAppearance, normalizeAppearance, type Appearance } from '../shared/appearance'

/** Device preferences deliberately live outside journal backup/restore. */
export async function openAppearance(path: string) {
    let current: Appearance
    try {
        current = normalizeAppearance(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
        if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
            console.warn('Could not read device appearance; using Dark + Neutral.', error)
        current = defaultAppearance
    }
    let queue = Promise.resolve()
    return {
        get: () => current,
        select: (input: unknown) => {
            const next = appearanceSchema.parse(input)
            const operation = queue.then(async () => {
                await writeFile(`${path}.tmp`, JSON.stringify(next), 'utf8')
                await rename(`${path}.tmp`, path)
                current = next
                return current
            })
            queue = operation.then(
                () => {
                    /* This queue only orders writes; the caller observes the result. */
                },
                () => {
                    /* A failed write must not poison the next attempt. */
                }
            )
            return operation
        }
    }
}
