import { Extension, InputRule } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { DOMParser as WritingParser, Fragment, Slice } from '@tiptap/pm/model'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
    directionalText,
    inheritWritingDirection,
    portableWriting,
    writingDirection
} from '../shared/journal-direction'
import type { WritingDirection } from '../shared/journal-direction'
import type { JournalNode } from '../shared/model'
import Blockquote from '@tiptap/extension-blockquote'

/** A quote's border follows its first prose block, including nested list/toggle leads. */
export const JournalBlockquote = Blockquote.extend({
    addNodeView() {
        return () => {
            const dom = document.createElement('blockquote')
            const update = () => {
                const first = dom.querySelector('[data-journal-text]')
                const direction = first?.matches(':dir(rtl)') ? 'rtl' : 'ltr'
                if (dom.style.direction !== direction) dom.style.direction = direction
            }
            const observer = new MutationObserver(update)
            observer.observe(dom, { childList: true, subtree: true, characterData: true, attributes: true })
            return {
                dom,
                contentDOM: dom,
                ignoreMutation: (mutation) => mutation.type === 'attributes' && mutation.target === dom,
                destroy: () => observer.disconnect()
            }
        }
    }
})

export type DirectionTarget = { scope: 'document' } | { scope: 'selection' } | { scope: 'caption'; position: number }

function destinationOverride(parent: Node): WritingDirection | null {
    return parent.isTextblock ? (writingDirection(parent.attrs.direction) ?? null) : null
}

/** Tiptap setContent replaces children, so load the root's policy in the same silent transaction. */
export function loadWriting(editor: Editor, document: JournalNode) {
    editor
        .chain()
        .setContent(document, { emitUpdate: false })
        .command(({ tr }) => {
            tr.setDocAttribute('direction', writingDirection(document.attrs?.direction) ?? null)
            return true
        })
        .run()
}

/** Plain formatted input (Markdown) follows the destination, including its interior blocks. */
export function insertPlainWriting(editor: Editor, html: string): boolean {
    if (!editor.isEditable) return false
    const container = document.createElement('div')
    container.innerHTML = html
    const parsed: JournalNode = WritingParser.fromSchema(editor.schema)
        .parse(container, { preserveWhitespace: 'full' })
        .toJSON()
    const policy = destinationOverride(editor.state.selection.$from.parent)
    return editor.commands.insertContent(inheritWritingDirection(parsed.content ?? [], policy))
}

export function selectedWritingDirection(editor: Editor): WritingDirection | null | 'mixed' | undefined {
    const values = new Set<WritingDirection | null>()
    const { from, to } = editor.state.selection
    editor.state.doc.nodesBetween(from, to, (node) => {
        if (directionalText(node.type.name) && node.type.name !== 'image')
            values.add(writingDirection(node.attrs.direction) ?? null)
    })
    return values.size > 1 ? 'mixed' : values.size ? [...values][0] : undefined
}

export function setWritingDirection(
    editor: Editor,
    target: DirectionTarget,
    direction: WritingDirection | null
): boolean {
    if (!editor.isEditable) return false
    const tr = closeHistory(editor.state.tr)
    if (target.scope === 'document') tr.setDocAttribute('direction', direction)
    else if (target.scope === 'caption') {
        const node = tr.doc.nodeAt(target.position)
        if (node?.type.name !== 'image') return false
        tr.setNodeMarkup(target.position, undefined, { ...node.attrs, direction })
    } else {
        const { from, to } = tr.selection
        tr.doc.nodesBetween(from, to, (node, position) => {
            if (directionalText(node.type.name) && node.type.name !== 'image')
                tr.setNodeMarkup(position, undefined, { ...node.attrs, direction })
        })
    }
    if (!tr.docChanged) return false
    editor.view.dispatch(tr)
    return true
}

/** Rendering is derived. Only changed top-level branches are redecorated while typing. */
function decorate(doc: Node, from = 0, to = doc.content.size) {
    const result: Decoration[] = []
    const policy = writingDirection(doc.attrs.direction) ?? 'auto'
    doc.nodesBetween(from, to, (node, position) => {
        if (directionalText(node.type.name))
            result.push(
                Decoration.node(position, position + node.nodeSize, {
                    dir: writingDirection(node.attrs.direction) ?? policy,
                    ...(node.type.name !== 'image' ? { 'data-journal-text': '' } : {})
                })
            )
        if (node.type.name === 'codeBlock')
            result.push(Decoration.node(position, position + node.nodeSize, { dir: 'ltr' }))
    })
    return result
}
const directionKey = new PluginKey<DecorationSet>('journalDirection')

function importedDirection(element: HTMLElement): WritingDirection | null {
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const direction = writingDirection(current.getAttribute('dir')?.toLowerCase())
        if (direction) return direction
    }
    return null
}

export const JournalDirection = Extension.create({
    name: 'journalDirection',
    priority: 1000,
    addInputRules() {
        return [
            new InputRule({
                find: /^(#{1,4})\s$/,
                handler: ({ state, range, match }) => {
                    const start = state.doc.resolve(range.from)
                    const type = this.editor.schema.nodes.heading
                    if (!start.node(-1).canReplaceWith(start.index(-1), start.indexAfter(-1), type)) return null
                    state.tr.delete(range.from, range.to).setBlockType(range.from, range.from, type, {
                        level: match[1].length,
                        direction: start.parent.attrs.direction
                    })
                }
            })
        ]
    },
    addGlobalAttributes() {
        return [
            {
                types: ['doc', 'paragraph', 'heading', 'toggleSummary', 'image'],
                attributes: {
                    direction: {
                        default: null,
                        parseHTML: importedDirection,
                        renderHTML: (attrs) => (writingDirection(attrs.direction) ? { dir: attrs.direction } : {})
                    }
                }
            }
        ]
    },
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: directionKey,
                state: {
                    init: (_, state) => DecorationSet.create(state.doc, decorate(state.doc)),
                    apply(tr, previous, oldState) {
                        if (!tr.docChanged) return previous
                        if (tr.doc.attrs.direction !== oldState.doc.attrs.direction)
                            return DecorationSet.create(tr.doc, decorate(tr.doc))
                        let start = Infinity
                        let end = -Infinity
                        // Content-diff endpoints can overlap for repeated identical blocks.
                        // Step maps locate the actual edits, mapped into the final document.
                        tr.mapping.maps.forEach((map, index) => {
                            const remaining = tr.mapping.slice(index + 1)
                            map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                                start = Math.min(start, remaining.map(newStart, -1))
                                end = Math.max(end, remaining.map(newEnd, 1))
                            })
                        })
                        let next = previous.map(tr.mapping, tr.doc)
                        tr.doc.forEach((node, offset) => {
                            if (offset > end || offset + node.nodeSize < start) return
                            const finish = offset + node.nodeSize
                            next = next.remove(
                                next.find(offset, finish).filter((item) => item.from >= offset && item.to <= finish)
                            )
                            next = next.add(tr.doc, decorate(tr.doc, offset, finish))
                        })
                        return next
                    }
                },
                props: {
                    decorations: (state) => directionKey.getState(state),
                    clipboardTextParser: (text, context, _plain, view) => {
                        const policy = destinationOverride(context.parent)
                        const paragraphs = text
                            .split(/(?:\r\n?|\n)+/)
                            .map((line) =>
                                view.state.schema.nodes.paragraph.create(
                                    { direction: policy },
                                    line ? view.state.schema.text(line, context.marks()) : undefined
                                )
                            )
                        return new Slice(Fragment.fromArray(paragraphs), 0, 0)
                    },
                    handlePaste: (view, _event, slice) => {
                        const { $to } = view.state.selection
                        if (
                            !view.editable ||
                            !slice.openEnd ||
                            !$to.parent.isTextblock ||
                            $to.parentOffset === $to.parent.content.size
                        )
                            return false
                        const policy = writingDirection($to.parent.attrs.direction) ?? null
                        const trailing = (fragment: Fragment, depth: number): Fragment => {
                            const last = fragment.lastChild
                            if (!last) return fragment
                            const node =
                                depth === 1 && directionalText(last.type.name) && last.type.name !== 'image'
                                    ? last.type.create({ ...last.attrs, direction: policy }, last.content, last.marks)
                                    : depth > 1
                                      ? last.copy(trailing(last.content, depth - 1))
                                      : last
                            return fragment.replaceChild(fragment.childCount - 1, node)
                        }
                        const prepared = new Slice(
                            trailing(slice.content, slice.openEnd),
                            slice.openStart,
                            slice.openEnd
                        )
                        if (prepared.content.eq(slice.content)) return false
                        view.dispatch(
                            view.state.tr
                                .replaceSelection(prepared)
                                .scrollIntoView()
                                .setMeta('paste', true)
                                .setMeta('uiEvent', 'paste')
                        )
                        return true
                    },
                    transformCopied: (slice, view) => {
                        const content = portableWriting({
                            type: 'doc',
                            attrs: view.state.doc.attrs,
                            content: slice.content.toJSON()
                        })
                        return new Slice(Fragment.fromJSON(view.state.schema, content), slice.openStart, slice.openEnd)
                    }
                }
            })
        ]
    }
})
