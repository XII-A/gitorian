import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { useEffect, useId, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import type { JournalNode } from '../shared/model'

const blocks = [
    { id: 'paragraph', label: 'Text', hint: 'A plain paragraph' },
    { id: 'heading', label: 'Heading', hint: 'A heading for a new thought' },
    { id: 'bullet', label: 'Bullet list', hint: 'A few things to remember' },
    { id: 'ordered', label: 'Numbered list', hint: 'One thing after another' },
    { id: 'task', label: 'Checklist', hint: 'Keep track of the next steps' },
    { id: 'quote', label: 'Quote', hint: 'Give a thought some space' },
    { id: 'code', label: 'Code block', hint: 'Keep a snippet of code' }
]
interface Menu {
    from: number
    to: number
    query: string
    x: number
    y: number
}

// Existing checklists and underlined drafts retain their full document model.
// New documents use Arc's editor in WorkspaceDraft.
export function Editor({
    value,
    onChange,
    readOnly = false,
    insertLink
}: {
    value: JournalNode
    onChange?: (body: JournalNode) => void
    readOnly?: boolean
    insertLink?: { url: string; title: string; nonce: number }
}) {
    const [menu, setMenu] = useState<Menu>()
    const menuRef = useRef<Menu | undefined>(undefined)
    const [active, setActive] = useState(0)
    const activeRef = useRef(0)
    const host = useRef<HTMLDivElement>(null)
    const id = useId()
    const updateMenu = (editor: TiptapEditor) => {
        const { $from, empty, from } = editor.state.selection
        const prefix = $from.parent.textBetween(0, $from.parentOffset, '\n')
        const match = empty && !readOnly ? /(?:^|\s)\/([^/]*)$/.exec(prefix) : null
        if (!match) {
            menuRef.current = undefined
            setMenu(undefined)
            return
        }
        const rect = host.current?.getBoundingClientRect()
        const coords = editor.view.coordsAtPos(from)
        const next = {
            from: from - match[1].length - 1,
            to: from,
            query: match[1],
            x: Math.max(0, Math.min((rect?.width ?? 300) - 250, coords.left - (rect?.left ?? 0))),
            y: coords.bottom - (rect?.top ?? 0) + 8
        }
        menuRef.current = next
        setMenu(next)
        activeRef.current = 0
        setActive(0)
    }
    const apply = (editor: TiptapEditor, block: string) => {
        const current = menuRef.current
        if (!current) return
        const chain = editor.chain().focus().deleteRange({ from: current.from, to: current.to })
        switch (block) {
            case 'heading':
                chain.setHeading({ level: 2 }).run()
                break
            case 'bullet':
                chain.toggleBulletList().run()
                break
            case 'ordered':
                chain.toggleOrderedList().run()
                break
            case 'task':
                chain.toggleTaskList().run()
                break
            case 'quote':
                chain.toggleBlockquote().run()
                break
            case 'code':
                chain.toggleCodeBlock().run()
                break
            default:
                chain.setParagraph().run()
        }
        menuRef.current = undefined
        setMenu(undefined)
    }
    const editorRef = useRef<TiptapEditor | null>(null)
    const editor = useEditor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
            TaskList,
            TaskItem.configure({ nested: true })
        ],
        content: value,
        editable: !readOnly,
        editorProps: {
            attributes: {
                'aria-label': readOnly ? 'Journal entry' : 'Journal body',
                role: 'textbox',
                'aria-multiline': 'true'
            },
            handleClick: (_view, _position, event) => {
                const anchor = (event.target as HTMLElement).closest('a')
                if (readOnly && anchor?.href) {
                    void window.journal.invoke({ type: 'open', url: anchor.href })
                    return true
                }
                return false
            },
            handleKeyDown: (_view, event) => {
                const current = menuRef.current
                if (!current || !editorRef.current) return false
                const filtered = blocks.filter((block) =>
                    block.label.toLowerCase().includes(current.query.toLowerCase())
                )
                if (event.key === 'Escape') {
                    setMenu(undefined)
                    menuRef.current = undefined
                    return true
                }
                if (['ArrowDown', 'ArrowUp'].includes(event.key) && filtered.length) {
                    activeRef.current =
                        (activeRef.current + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length
                    setActive(activeRef.current)
                    return true
                }
                if (['Enter', 'Tab'].includes(event.key) && filtered[activeRef.current]) {
                    apply(editorRef.current, filtered[activeRef.current].id)
                    return true
                }
                return false
            }
        },
        onUpdate: ({ editor: updated }) => {
            const body = updated.getJSON() as JournalNode
            onChange?.(body)
            updateMenu(updated)
        },
        onSelectionUpdate: ({ editor: updated }) => updateMenu(updated)
    })
    useEffect(() => {
        editorRef.current = editor
    }, [editor])
    useEffect(() => {
        if (editor && JSON.stringify(value) !== JSON.stringify(editor.getJSON()))
            editor.commands.setContent(value, { emitUpdate: false })
    }, [value, editor])
    useEffect(() => {
        editor?.setEditable(!readOnly, false)
    }, [editor, readOnly])
    useEffect(() => {
        if (insertLink && editor && !readOnly)
            editor
                .chain()
                .focus()
                .insertContent({
                    type: 'text',
                    text: insertLink.title,
                    marks: [{ type: 'link', attrs: { href: insertLink.url } }]
                })
                .run()
    }, [insertLink, editor, readOnly])
    useEffect(() => {
        if (!editor) return
        const attrs: Record<string, string> = menu
            ? {
                  'aria-expanded': 'true',
                  'aria-controls': `${id}-blocks`,
                  'aria-activedescendant': `${id}-block-${active}`
              }
            : { 'aria-expanded': 'false' }
        editor.setOptions({
            editorProps: {
                attributes: {
                    'aria-label': readOnly ? 'Journal entry' : 'Journal body',
                    role: 'textbox',
                    'aria-multiline': 'true',
                    ...attrs
                }
            }
        })
    }, [editor, menu, id, active, readOnly])
    if (!editor) return null
    const filtered = blocks.filter((block) => block.label.toLowerCase().includes(menu?.query.toLowerCase() ?? ''))
    return (
        <div className="journal-editor ws-legacy-editor" ref={host}>
            <EditorContent editor={editor} />
            {menu && (
                <div
                    className="ws-block-menu"
                    id={`${id}-blocks`}
                    role="listbox"
                    aria-label="Formatting blocks"
                    style={{ left: menu.x, top: menu.y }}
                >
                    <ScrollArea
                        className="ws-block-options"
                        label="Formatting options"
                        maxHeight="min(320px, 50dvh)"
                        fade={8}
                    >
                        {filtered.length ? (
                            filtered.map((block, index) => (
                                <button
                                    type="button"
                                    key={block.id}
                                    role="option"
                                    id={`${id}-block-${index}`}
                                    aria-selected={active === index}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => apply(editor, block.id)}
                                >
                                    <span>{block.label}</span>
                                    <small>{block.hint}</small>
                                </button>
                            ))
                        ) : (
                            <p>No matching formats</p>
                        )}
                    </ScrollArea>
                </div>
            )}
        </div>
    )
}
