import type { JournalNode } from './model'

export type WritingDirection = 'auto' | 'ltr' | 'rtl'
export const writingDirections = ['auto', 'ltr', 'rtl'] as const
export const directionLabels = { auto: 'Automatic', ltr: 'Left to right', rtl: 'Right to left' }
export function writingDirection(value: unknown): WritingDirection | undefined {
    return value === 'auto' || value === 'ltr' || value === 'rtl' ? value : undefined
}
export const directionalText = (type: string) => ['paragraph', 'heading', 'toggleSummary', 'image'].includes(type)

/** Transfer source policy, not its current inferred direction, out of a document. */
export function portableWriting(document: JournalNode): JournalNode[] {
    const policy = writingDirection(document.attrs?.direction) ?? 'auto'
    return inheritWritingDirection(document.content ?? [], policy)
}

/** Fill missing policies, retaining inheritance when the destination itself inherits. */
export function inheritWritingDirection(content: JournalNode[], policy: WritingDirection | null): JournalNode[] {
    const visit = (node: JournalNode): JournalNode => ({
        ...node,
        ...(directionalText(node.type)
            ? { attrs: { ...node.attrs, direction: writingDirection(node.attrs?.direction) ?? policy } }
            : {}),
        ...(node.content ? { content: node.content.map(visit) } : {})
    })
    return content.map(visit)
}
