import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { loadCodeHighlighting, type CodeHighlighting, type CodeRun } from './code-highlighting'

interface CodeState {
    decorations: DecorationSet
    nodes: Map<Node, CodeRun[]>
}
const key = new PluginKey<CodeState>('code-highlighting')

/** Decorations share the editor's immutable nodes, never its persisted document. */
export function codeHighlightingPlugin(): Plugin<CodeState> {
    let runtime: CodeHighlighting = { status: 'unavailable' }
    let composing = false
    const decorate = (doc: Node, previous = new Map<Node, CodeRun[]>()): CodeState => {
        const nodes = new Map<Node, CodeRun[]>()
        const decorations: Decoration[] = []
        doc.descendants((node, position) => {
            if (node.type.name !== 'codeBlock') return
            const runs =
                previous.get(node) ??
                (runtime.status === 'ready' ? runtime.highlight(node.textContent, node.attrs.language) : [])
            nodes.set(node, runs)
            for (const run of runs) {
                const style = `color:${run.style.color ?? 'inherit'};font-style:${run.style.fontStyle ?? 'normal'};font-weight:${run.style.fontWeight ?? 400}`
                decorations.push(
                    Decoration.inline(position + 1 + run.from, position + 1 + run.to, { style, 'data-code-token': '' })
                )
            }
            return false
        })
        return { decorations: DecorationSet.create(doc, decorations), nodes }
    }
    return new Plugin<CodeState>({
        key,
        state: {
            init: (_, state) => decorate(state.doc),
            apply(transaction, previous) {
                const ready = transaction.getMeta(key) as CodeHighlighting | true | undefined
                if (ready && ready !== true) runtime = ready
                if (!ready && !transaction.docChanged) return previous
                if (composing)
                    return { ...previous, decorations: previous.decorations.map(transaction.mapping, transaction.doc) }
                return decorate(transaction.doc, ready ? undefined : previous.nodes)
            }
        },
        props: {
            decorations: (state) => key.getState(state)?.decorations,
            handleDOMEvents: {
                compositionstart: () => {
                    composing = true
                    return false
                },
                compositionend: (view) => {
                    composing = false
                    queueMicrotask(() => {
                        if (!view.isDestroyed)
                            view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
                    })
                    return false
                }
            }
        },
        view(view) {
            let destroyed = false
            void loadCodeHighlighting().then((ready) => {
                if (!destroyed) view.dispatch(view.state.tr.setMeta(key, ready).setMeta('addToHistory', false))
            })
            return {
                destroy() {
                    destroyed = true
                }
            }
        }
    })
}
