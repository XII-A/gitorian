import type { Editor } from '@tiptap/react'
import { Fragment, type Node, type Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { liftListItem } from '@tiptap/pm/schema-list'
import { lift } from '@tiptap/pm/commands'

function formattedBlock(schema: Schema, format: string, content: Fragment): { node: Node; textOffset: number } {
    const paragraph = schema.nodes.paragraph.create(null, content)
    if (format.startsWith('heading'))
        return { node: schema.nodes.heading.create({ level: Number(format.slice(-1)) }, content), textOffset: 1 }
    switch (format) {
        case 'toggle':
            return {
                node: schema.nodes.toggle.create(null, [
                    schema.nodes.toggleSummary.create(null, content),
                    schema.nodes.toggleContent.create(null, schema.nodes.paragraph.create())
                ]),
                textOffset: 2
            }
        case 'bullet':
        case 'ordered':
        case 'task': {
            const list = format === 'bullet' ? 'bulletList' : format === 'ordered' ? 'orderedList' : 'taskList'
            const item = format === 'task' ? 'taskItem' : 'listItem'
            return { node: schema.nodes[list].create(null, schema.nodes[item].create(null, paragraph)), textOffset: 3 }
        }
        case 'quote':
            return { node: schema.nodes.blockquote.create(null, paragraph), textOffset: 2 }
        case 'code': {
            const text = paragraph.textBetween(0, paragraph.content.size, '\n', '\n')
            return { node: schema.nodes.codeBlock.create(null, text ? schema.text(text) : undefined), textOffset: 1 }
        }
        default:
            return { node: paragraph, textOffset: 1 }
    }
}

/** Slash block names create; explicit /turn commands convert the current block. */
export function applyBlockFormat(
    editor: Editor,
    format: string,
    range: { from: number; to: number },
    convert: boolean
) {
    let alreadyFormatted = false
    return editor
        .chain()
        .focus()
        .deleteRange(range)
        .command(({ tr, state }) => {
            const { $from } = tr.selection
            const parent = $from.node($from.depth - 1)
            const current = ['listItem', 'taskItem'].includes(parent.type.name)
                ? $from.node($from.depth - 2)
                : parent.type.name === 'blockquote'
                  ? parent
                  : $from.parent
            const desired = formattedBlock(state.schema, format, Fragment.empty).node
            alreadyFormatted =
                convert &&
                current.type === desired.type &&
                (format.startsWith('heading') ? current.attrs.level === desired.attrs.level : true)
            if (alreadyFormatted) return true
            if (!convert && tr.selection.$from.parent.content.size) return true
            // Normalize only the current block's list/quote wrappers. Use a fresh
            // state for each lift: schema-list maps positions through its entire
            // transaction, so it cannot share the earlier slash-deletion mapping.
            for (let remaining = tr.selection.$from.depth; remaining > 0; remaining--) {
                const { $from } = tr.selection
                const parent = $from.node($from.depth - 1).type
                const command = ['listItem', 'taskItem'].includes(parent.name)
                    ? liftListItem(parent)
                    : parent.name === 'blockquote'
                      ? lift
                      : undefined
                if (!command) break
                const snapshot = EditorState.create({ schema: state.schema, doc: tr.doc, selection: tr.selection })
                if (
                    !command(snapshot, (lifted) => {
                        lifted.steps.forEach((step) => tr.step(step))
                        tr.setSelection(TextSelection.create(tr.doc, lifted.selection.from, lifted.selection.to))
                    })
                )
                    break
            }
            return true
        })
        .command(({ tr, state }) => {
            if (alreadyFormatted) return true
            const { $from } = tr.selection
            const source = $from.parent
            const summary = source.type.name === 'toggleSummary'
            const depth = summary ? $from.depth - 1 : $from.depth
            const position = $from.before(depth)
            const sourceBlock = $from.node(depth)
            const reuse = convert || !source.content.size
            const target = formattedBlock(state.schema, format, convert ? source.content : Fragment.empty)
            if (format !== 'code') {
                const preserveDirection = (node: Node): Node => {
                    if (['paragraph', 'heading', 'toggleSummary'].includes(node.type.name))
                        return node.type.create(
                            { ...node.attrs, direction: source.attrs.direction ?? null },
                            node.content,
                            node.marks
                        )
                    const children: Node[] = []
                    node.forEach((child) => children.push(preserveDirection(child)))
                    return node.copy(Fragment.fromArray(children))
                }
                target.node = preserveDirection(target.node)
            }
            if (!reuse) {
                // Find the nearest container that accepts a sibling of this type.
                // A toggle summary is part of its toggle, never an insertion container.
                for (let level = depth; level > 0; level--) {
                    const parent = $from.node(level - 1)
                    const index = $from.index(level - 1) + 1
                    if (!parent.canReplaceWith(index, index, target.node.type)) continue
                    const after = $from.after(level)
                    tr.insert(after, target.node)
                    tr.setSelection(TextSelection.create(tr.doc, after + target.textOffset))
                    tr.setStoredMarks([])
                    return true
                }
                return false
            }
            if (summary && format === 'toggle') return true
            const children: Node[] = [target.node]
            if (summary) {
                const body = sourceBlock.lastChild!
                const empty =
                    body.childCount === 1 &&
                    body.firstChild!.type.name === 'paragraph' &&
                    !body.firstChild!.content.size
                if (!empty) body.forEach((child) => children.push(child))
            }
            const parent = $from.node(depth - 1)
            const index = $from.index(depth - 1)
            if (!parent.canReplace(index, index + 1, Fragment.fromArray(children))) return false
            tr.replaceWith(position, position + sourceBlock.nodeSize, children)
            const offset = convert ? Math.min($from.parentOffset, target.node.textContent.length) : 0
            tr.setSelection(TextSelection.create(tr.doc, position + target.textOffset + offset))
            tr.setStoredMarks([])
            return true
        })
        .run()
}
