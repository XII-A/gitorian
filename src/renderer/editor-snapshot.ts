import type { Node } from '@tiptap/pm/model'
import type { JournalNode } from '../shared/model'

export interface EditorSnapshot {
    read: () => JournalNode
    wordCount: () => number
}

export function journalWordCount(document: JournalNode): number {
    const text = (node: JournalNode): string => {
        if (node.type === 'text') return node.text ?? ''
        if (node.type === 'hardBreak') return ' '
        const inline = ['paragraph', 'heading', 'toggleSummary', 'codeBlock'].includes(node.type)
        return (node.content ?? []).map(text).join(inline ? '' : ' ')
    }
    return text(document).match(/\S+/g)?.length ?? 0
}

/** A revision of the immutable editor tree, serialized only when a consumer needs it. */
export function editorSnapshot(document: Node): EditorSnapshot {
    let json: JournalNode | undefined
    return {
        read: () => (json ??= document.toJSON() as JournalNode),
        wordCount: () => document.textBetween(0, document.content.size, ' ', ' ').match(/\S+/g)?.length ?? 0
    }
}
