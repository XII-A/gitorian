import { JournalDirection, JournalBlockquote } from './journal-direction'
import { Extension, InputRule, Node, textInputRule, mergeAttributes } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { JournalNode } from '../shared/model'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { moveToggleBlock } from './toggle-indentation'
import { JournalImageNode, ImageImportPositions } from './journal-images'
import { JournalCodeBlock } from './journal-code-block'

function deleteToggleWordBackward(editor: Editor): boolean {
    const { $from, from, empty } = editor.state.selection
    if (!editor.isEditable || !empty) return false
    let depth = $from.depth
    while (depth > 0 && $from.node(depth).type.name !== 'toggle') depth--
    if (!depth || !$from.parent.isTextblock) return false
    if (!$from.parentOffset) {
        const firstBodyParagraph =
            $from.parent.type.name === 'paragraph' &&
            $from.node($from.depth - 1).type.name === 'toggleContent' &&
            $from.index($from.depth - 1) === 0
        if ($from.parent.type.name === 'toggleSummary') return unwrapToggle(editor, depth)
        if (firstBodyParagraph) return backspaceFromToggleBody(editor, depth)
        // Word deletion stays within its text block, including nested list items.
        return true
    }
    const prefix = $from.parent.textBetween(0, $from.parentOffset, '\n', '\uFFFC')
    const trimmed = prefix.trimEnd()
    const word = /[\p{L}\p{M}\p{N}_]+$|[^\p{L}\p{M}\p{N}_\s]+$/u.exec(trimmed)
    const start = word?.index ?? 0
    return editor.commands.deleteRange({ from: from - (prefix.length - start), to: from })
}

function backspaceFromToggleBody(editor: Editor, depth: number): boolean {
    const { $from } = editor.state.selection
    if (!$from.parent.content.size) {
        const summary = $from.node(depth).firstChild!
        return editor.commands.setTextSelection($from.before(depth) + 2 + summary.content.size)
    }
    return unwrapToggle(editor, depth)
}

function unwrapToggle(editor: Editor, depth: number) {
    const { $from } = editor.state.selection
    const toggle = $from.node(depth)
    const position = $from.before(depth)
    const summary = toggle.firstChild!
    const contents = toggle.lastChild!
    const blocks: JournalNode[] = [
        {
            type: 'paragraph',
            attrs: { direction: summary.attrs.direction },
            content: (summary.toJSON() as JournalNode).content
        }
    ]
    const emptyBody =
        contents.childCount === 1 && contents.firstChild?.type.name === 'paragraph' && !contents.firstChild.content.size
    if (!emptyBody) contents.forEach((node) => blocks.push(node.toJSON() as JournalNode))
    return editor
        .chain()
        .insertContentAt({ from: position, to: position + toggle.nodeSize }, blocks, { updateSelection: false })
        .setTextSelection(position + 1)
        .run()
}

const Toggle = Node.create({
    name: 'toggle',
    group: 'block',
    content: 'toggleSummary toggleContent',
    defining: true,
    parseHTML: () => [{ tag: 'div[data-type="toggle"]' }],
    renderHTML: () => ['div', { 'data-type': 'toggle' }, 0],
    addKeyboardShortcuts() {
        return {
            'Ctrl-Backspace': () => deleteToggleWordBackward(this.editor)
        }
    },
    addProseMirrorPlugins() {
        return [
            new Plugin({
                props: {
                    handleDOMEvents: {
                        beforeinput: (_view, event) => {
                            if (event.inputType !== 'deleteWordBackward' || !deleteToggleWordBackward(this.editor))
                                return false
                            event.preventDefault()
                            return true
                        }
                    }
                }
            })
        ]
    },
    addNodeView() {
        return ({ editor, getPos }) => {
            const dom = document.createElement('div')
            dom.dataset.type = 'toggle'
            dom.dataset.open = 'true'
            const button = document.createElement('button')
            button.type = 'button'
            button.contentEditable = 'false'
            button.setAttribute('aria-label', 'Toggle content')
            button.setAttribute('aria-expanded', 'true')
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            icon.setAttribute('viewBox', '0 0 16 16')
            icon.setAttribute('width', '16')
            icon.setAttribute('height', '16')
            icon.setAttribute('aria-hidden', 'true')
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('d', 'm6 4 4 4-4 4')
            path.setAttribute('fill', 'none')
            path.setAttribute('stroke', 'currentColor')
            path.setAttribute('stroke-width', '1.5')
            path.setAttribute('stroke-linecap', 'round')
            path.setAttribute('stroke-linejoin', 'round')
            icon.append(path)
            button.append(icon)
            const contentDOM = document.createElement('div')
            button.addEventListener('mousedown', (event) => event.preventDefault())
            button.addEventListener('click', () => {
                const open = dom.dataset.open !== 'true'
                dom.dataset.open = String(open)
                button.setAttribute('aria-expanded', String(open))
                const position = getPos()
                if (!open && editor.isEditable && position !== undefined) {
                    const size = editor.state.doc.nodeAt(position)?.nodeSize ?? 0
                    const selection = editor.state.selection
                    if (selection.from > position && selection.from < position + size)
                        editor.commands.setTextSelection(position + 2)
                }
            })
            dom.append(button, contentDOM)
            return {
                dom,
                contentDOM,
                stopEvent: (event) => event.target instanceof window.Node && button.contains(event.target),
                ignoreMutation: (mutation) =>
                    mutation.type === 'attributes' && (mutation.target === dom || mutation.target === button)
            }
        }
    }
})
const ToggleSummary = Node.create({
    name: 'toggleSummary',
    content: 'inline*',
    defining: true,
    parseHTML: () => [{ tag: 'div[data-type="toggleSummary"]' }],
    renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggleSummary' }), 0],
    addKeyboardShortcuts() {
        return {
            Backspace: () => {
                const { $from, empty } = this.editor.state.selection
                if (!empty || $from.parent.type.name !== 'toggleSummary' || $from.parentOffset !== 0) return false
                return unwrapToggle(this.editor, $from.depth - 1)
            },
            Delete: () => {
                const { $from, empty } = this.editor.state.selection
                if (!empty || $from.parent.type.name !== 'toggleSummary' || $from.parent.content.size) return false
                const toggle = $from.node($from.depth - 1)
                if (toggle.lastChild?.textContent) return false
                return unwrapToggle(this.editor, $from.depth - 1)
            },
            Enter: () => {
                const { $from } = this.editor.state.selection
                if ($from.parent.type.name !== 'toggleSummary') return false
                const dom = this.editor.view.nodeDOM($from.before($from.depth - 1))
                if (dom instanceof HTMLElement && dom.dataset.open === 'false')
                    dom.querySelector<HTMLButtonElement>(':scope > button')?.click()
                return this.editor.commands.setTextSelection($from.after() + 2)
            }
        }
    }
})
const ToggleContent = Node.create({
    name: 'toggleContent',
    content: 'block+',
    defining: true,
    parseHTML: () => [{ tag: 'div[data-type="toggleContent"]' }],
    renderHTML: () => ['div', { 'data-type': 'toggleContent' }, 0],
    addKeyboardShortcuts() {
        return {
            Backspace: () => {
                const { $from, empty } = this.editor.state.selection
                if (
                    !this.editor.isEditable ||
                    !empty ||
                    $from.parent.type.name !== 'paragraph' ||
                    $from.parentOffset ||
                    $from.depth < 3 ||
                    $from.node($from.depth - 1).type.name !== 'toggleContent' ||
                    $from.index($from.depth - 1) !== 0
                )
                    return false
                return backspaceFromToggleBody(this.editor, $from.depth - 2)
            }
        }
    }
})

const ToggleIndentation = Extension.create({
    name: 'toggleIndentation',
    priority: 1100,
    addKeyboardShortcuts() {
        return {
            Tab: () => moveToggleBlock(this.editor, false),
            'Shift-Tab': () => moveToggleBlock(this.editor, true)
        }
    }
})

const EditorTabFallback = Extension.create({
    name: 'editorTabFallback',
    // Let toggle and list shortcuts act first. An unsupported indent must not
    // become browser focus navigation to a toggle button or an earlier control.
    priority: -100,
    addKeyboardShortcuts() {
        const consume = () => this.editor.isEditable && !this.editor.view.composing
        return { Tab: consume, 'Shift-Tab': consume }
    }
})

const DashTypography = Extension.create({
    name: 'dashTypography',
    addInputRules() {
        return [
            textInputRule({ find: /--$/, replace: '—' }),
            // The second hyphen already became an em dash. Preserve the existing
            // three-hyphen divider shortcut when the third hyphen is typed.
            new InputRule({
                find: /^—-$/,
                handler: ({ range, chain }) => {
                    chain().deleteRange(range).setHorizontalRule().run()
                }
            })
        ]
    }
})

const BlockSelectAll = Extension.create({
    name: 'blockSelectAll',
    priority: 1100,
    addKeyboardShortcuts() {
        return {
            'Mod-a': () => {
                const { selection } = this.editor.state
                const { $from, $to, from, to } = selection
                if (
                    selection instanceof TextSelection &&
                    $from.sameParent($to) &&
                    $from.parent.isTextblock &&
                    $from.parent.content.size > 0 &&
                    (from !== $from.start() || to !== $from.end())
                ) {
                    return this.editor.commands.setTextSelection({ from: $from.start(), to: $from.end() })
                }
                return this.editor.commands.selectAll()
            }
        }
    }
})

export const journalExtensions = () => [
    JournalDirection,
    JournalBlockquote,
    BlockSelectAll,
    JournalImageNode,
    ImageImportPositions,
    JournalCodeBlock,
    StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false }
    }),
    TaskList,
    // TaskItem's live node view uses HTMLAttributes, not renderHTML's data-type.
    // Keep its editable content beside the checkbox in both rendered forms.
    TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
    Toggle,
    ToggleSummary,
    ToggleContent,
    ToggleIndentation,
    EditorTabFallback,
    DashTypography
]
