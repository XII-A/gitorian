import type { Editor } from '@tiptap/react'
import { Fragment } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

const listTypes = new Set(['bulletList', 'orderedList', 'taskList'])

/** Move blocks across a toggle boundary without replacing the document or resetting history. */
export function moveToggleBlock(editor: Editor, outdent: boolean): boolean {
    if (!editor.isEditable || editor.view.composing) return false
    const { selection, schema } = editor.state
    const { $from, $to } = selection
    if ($from.parent.type.spec.code) return false
    let depth = $from.depth
    while (depth > 0 && !['doc', 'toggleContent'].includes($from.node(depth).type.name)) depth--
    const container = $from.node(depth)
    if ($to.pos > $from.end(depth)) return false
    const first = $from.index(depth)
    const end = selection.empty ? $to : editor.state.doc.resolve($to.pos - 1)
    const last = end.index(depth) + 1
    const start = $from.posAtIndex(first, depth)
    // Following siblings travel with an outdented range so its reading order cannot reverse.
    const finish = outdent ? $from.end(depth) : $from.posAtIndex(last, depth)
    let moved = container.content.cut(start - $from.start(depth), finish - $from.start(depth))
    let remaining = Fragment.empty
    let anchor = selection.anchor - start
    let head = selection.head - start
    const block = container.child(first)

    if (last === first + 1 && listTypes.has(block.type.name) && $from.depth > depth + 1 && end.depth > depth + 1) {
        const listDepth = depth + 1
        // Nested lists keep their normal list indentation, rather than moving an outer item.
        for (let d = $from.depth; d > listDepth + 1; d--)
            if (['listItem', 'taskItem'].includes($from.node(d).type.name)) return false
        const fromItem = $from.index(listDepth)
        if (!outdent && fromItem !== 0) return false
        const toItem = outdent ? block.childCount : end.index(listDepth) + 1
        const itemStart = $from.posAtIndex(fromItem, listDepth)
        const itemEnd = $from.posAtIndex(toItem, listDepth)
        const listStart = start + 1
        const offset = (block.attrs.start as number | undefined) ?? 1
        const attrs = block.type.name === 'orderedList' ? { ...block.attrs, start: offset + fromItem } : block.attrs
        moved = Fragment.from(block.type.create(attrs, block.content.cut(itemStart - listStart, itemEnd - listStart)))
        if (outdent) moved = moved.append(container.content.cut(start + block.nodeSize - $from.start(depth)))
        const rest = block.content.cut(0, itemStart - listStart).append(block.content.cut(itemEnd - listStart))
        if (rest.size) {
            const restAttrs =
                block.type.name === 'orderedList' && fromItem === 0
                    ? { ...block.attrs, start: offset + toItem }
                    : block.attrs
            remaining = Fragment.from(block.type.create(restAttrs, rest))
        }
        anchor = selection.anchor - itemStart + 1
        head = selection.head - itemStart + 1
    }

    let target: number
    let togglePosition: number
    if (outdent) {
        if (!depth || $from.node(depth - 1).type.name !== 'toggle') return false
        togglePosition = $from.before(depth - 1)
        target = $from.after(depth - 1)
        if (first === 0 && !remaining.size) remaining = Fragment.from(schema.nodes.paragraph.create())
    } else {
        if (first === 0 || container.child(first - 1).type.name !== 'toggle') return false
        const previous = container.child(first - 1)
        togglePosition = start - previous.nodeSize
        target = start - 2 // Immediately before the preceding toggleContent's closing token.
    }

    const tr = closeHistory(editor.state.tr).replaceWith(start, finish, remaining)
    const destination = tr.mapping.map(target, outdent ? 1 : -1)
    tr.insert(destination, moved)
    tr.setSelection(
        selection instanceof NodeSelection
            ? NodeSelection.create(tr.doc, destination)
            : TextSelection.create(tr.doc, destination + anchor, destination + head)
    )
    editor.view.dispatch(tr.scrollIntoView())
    // Keep subsequent typing separate from this single structural undo step.
    editor.view.dispatch(closeHistory(editor.state.tr))
    if (!outdent) {
        const dom = editor.view.nodeDOM(togglePosition)
        if (dom instanceof HTMLElement && dom.dataset.open === 'false')
            dom.querySelector<HTMLButtonElement>(':scope > button')?.click()
    }
    return true
}
