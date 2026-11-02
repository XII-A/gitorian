import { z } from 'zod'
import type { JournalNode } from './model'

export const writingLimits = { updateBytes: 2_000_000, documentBytes: 8_000_000, steps: 128 } as const
export const writingSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
export function writingBatch(steps: unknown[]) {
    const batch: unknown[] = []
    let bytes = 2
    for (const step of steps.slice(0, writingLimits.steps)) {
        const size = writingSize(step) + (batch.length ? 1 : 0)
        if (bytes + size > writingLimits.updateBytes) {
            if (!batch.length) throw new Error('This writing operation exceeds the size limit.')
            break
        }
        batch.push(step)
        bytes += size
    }
    return batch
}

export const writingRequest = z.object({
    draftId: z.string().min(1),
    generation: z.string(),
    field: z.enum(['body', 'title']),
    version: z.number().int().nonnegative(),
    client: z.uuid(),
    steps: z.array(z.unknown()).max(2000)
})
export type WritingRequest = z.infer<typeof writingRequest>
export interface WritingState {
    draftId: string
    generation: string
    field: 'body' | 'title'
    version: number
    fromVersion: number
    document: JournalNode
    steps: unknown[]
    clients: string[]
}
export interface WritingBridge {
    claim: (client: string) => Promise<boolean>
    release: (client: string) => Promise<void>
    open: (draftId: string, generation: string, field: 'body' | 'title') => Promise<WritingState>
    submit: (request: WritingRequest) => Promise<WritingState>
    onChange: (listener: (state: WritingState) => void) => () => void
    onPrepare: (listener: (id: string) => Promise<void>) => () => void
    onResume: (listener: () => void) => () => void
}
