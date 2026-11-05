import { z } from 'zod'

/** Presentation choices are durable; content filters belong to the current review. */
export const diffPreferencesSchema = z.object({
    dockedSplit: z.boolean(),
    detachedSplit: z.boolean(),
    wrapLines: z.boolean(),
    originalIndentation: z.boolean(),
    showLineCounts: z.boolean(),
    fileList: z.enum(['tree', 'list']),
    order: z.enum(['path', 'changes'])
})

export type DiffPreferences = z.infer<typeof diffPreferencesSchema>

export const defaultDiffPreferences: DiffPreferences = {
    dockedSplit: false,
    detachedSplit: true,
    wrapLines: true,
    originalIndentation: false,
    showLineCounts: true,
    fileList: 'tree',
    order: 'path'
}
