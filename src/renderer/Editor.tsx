import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { journalExtensions } from './journal-extensions'
import './journal-editor.css'
import type { JournalNode } from '../shared/model'
import {
    Bold,
    Italic,
    Strikethrough,
    Code,
    Link,
    Type,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    ChevronRight,
    List,
    ListOrdered,
    ListChecks,
    Quote,
    FileCode,
    BookTemplate
} from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Input } from './components/arc/input/input'
import { Popover, PopoverAnchor, PopoverTrigger, PopoverContent } from './components/arc/popover/popover'
import { markdownToHtml } from './components/arc/rich-text-editor/rich-text-editor'

const blocks = [
    { id: 'paragraph', label: 'Text', icon: Type },
    { id: 'heading1', label: 'Heading 1', icon: Heading1 },
    { id: 'heading2', label: 'Heading 2', icon: Heading2 },
    { id: 'heading3', label: 'Heading 3', icon: Heading3 },
    { id: 'heading4', label: 'Heading 4', icon: Heading4 },
    { id: 'toggle', label: 'Toggle', icon: ChevronRight },
    { id: 'bullet', label: 'Bullet list', icon: List },
    { id: 'ordered', label: 'Numbered list', icon: ListOrdered },
    { id: 'task', label: 'Checklist', icon: ListChecks },
    { id: 'quote', label: 'Quote', icon: Quote },
    { id: 'code', label: 'Code block', icon: FileCode }
]
interface Menu {
    from: number
    to: number
    query: string
    x: number
    y: number
    height: number
}

export interface EditorHandle {
    undo: () => void
    redo: () => void
}

export function Editor({
    value,
    onChange,
    readOnly = false,
    insertLink,
    ref,
    label,
    onHistoryChange,
    template
}: {
    value: JournalNode
    onChange?: (body: JournalNode) => void
    readOnly?: boolean
    insertLink?: { url: string; title: string; nonce: number }
    ref?: Ref<EditorHandle>
    label?: string
    template?: JournalNode
    onHistoryChange?: (history: { canUndo: boolean; canRedo: boolean }) => void
}) {
    const availableBlocks = useMemo(
        () => (template ? [...blocks, { id: 'template', label: 'Use entry template', icon: BookTemplate }] : blocks),
        [template]
    )
    const menuViewport = useRef<HTMLDivElement>(null)
    const menuElement = useRef<HTMLDivElement>(null)
    const emitted = useRef<JournalNode>(value)
    const extensions = useMemo(journalExtensions, [])
    const [bar, setBar] = useState<{ x: number; y: number }>()
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkURL, setLinkURL] = useState('')
    const validLink = !linkURL || /^(https?:|mailto:|tel:|\/|#)/i.test(linkURL)
    const [menu, setMenu] = useState<Menu>()
    const menuRef = useRef<Menu | undefined>(undefined)
    const [active, setActive] = useState(0)
    const activeRef = useRef(0)
    const host = useRef<HTMLDivElement>(null)
    const id = useId()
    const updateMenu = (editor: TiptapEditor) => {
        const { $from, empty, from } = editor.state.selection
        if (!empty && !readOnly) {
            const rect = host.current?.getBoundingClientRect()
            const coords = editor.view.coordsAtPos(from)
            setBar({
                x: Math.max(0, Math.min((rect?.width ?? 300) - 260, coords.left - (rect?.left ?? 0))),
                y: coords.top - (rect?.top ?? 0) - 44
            })
        } else setBar(undefined)
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
            height: coords.bottom - coords.top,
            from: from - match[1].length - 1,
            to: from,
            query: match[1],
            x: coords.left - (rect?.left ?? 0),
            y: coords.top - (rect?.top ?? 0)
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
            case 'template':
                if (template) chain.insertContent(structuredClone(template.content ?? [])).run()
                break
            case 'heading1':
            case 'heading2':
            case 'heading3':
            case 'heading4':
                chain.setHeading({ level: Number(block.slice(-1)) as 1 | 2 | 3 | 4 }).run()
                break
            case 'toggle': {
                chain
                    .insertContent({
                        type: 'toggle',
                        content: [
                            { type: 'toggleSummary' },
                            { type: 'toggleContent', content: [{ type: 'paragraph' }] }
                        ]
                    })
                    .run()
                let summaryPosition: number | undefined
                editor.state.doc.descendants((node, position) => {
                    if (
                        summaryPosition === undefined &&
                        node.type.name === 'toggleSummary' &&
                        position >= current.from - 1
                    )
                        summaryPosition = position + 1
                })
                if (summaryPosition !== undefined) editor.commands.setTextSelection(summaryPosition)
                break
            }
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
        extensions,
        shouldRerenderOnTransaction: false,
        content: value,
        editable: !readOnly,
        editorProps: {
            attributes: {
                'aria-label': label ?? (readOnly ? 'Journal entry' : 'Journal body'),
                role: 'textbox',
                'aria-multiline': 'true'
            },
            handlePaste: (_view, event) => {
                const clipboard = event.clipboardData
                const text = clipboard?.getData('text/plain') ?? ''
                if (
                    clipboard?.getData('text/html') ||
                    !/(^#{1,4}\s|^\s*[-*+>]\s|^\s*\d+[.)]\s|`|\*\*|\[[^\]]+\]\()/m.test(text)
                )
                    return false
                if (!editorRef.current || readOnly) return false
                editorRef.current.commands.insertContent(markdownToHtml(text))
                return true
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
                const filtered = availableBlocks.filter((block) =>
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
            emitted.current = body
            onChange?.(body)
            updateMenu(updated)
        },
        onTransaction: ({ editor: updated }) =>
            onHistoryChange?.({ canUndo: updated.can().undo(), canRedo: updated.can().redo() }),
        onSelectionUpdate: ({ editor: updated }) => updateMenu(updated)
    })
    useImperativeHandle(
        ref,
        () => ({
            undo: () => {
                editor?.commands.undo()
            },
            redo: () => {
                editor?.commands.redo()
            }
        }),
        [editor]
    )
    useEffect(() => {
        editorRef.current = editor
    }, [editor])
    useEffect(() => {
        if (editor && value !== emitted.current && JSON.stringify(value) !== JSON.stringify(editor.getJSON()))
            editor.commands.setContent(value, { emitUpdate: false })
        emitted.current = value
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
                    'aria-label': label ?? (readOnly ? 'Journal entry' : 'Journal body'),
                    role: 'textbox',
                    'aria-multiline': 'true',
                    ...attrs
                }
            }
        })
    }, [editor, menu, id, active, readOnly, label])
    useLayoutEffect(() => {
        const viewport = menuViewport.current
        const option = menuElement.current?.querySelector<HTMLElement>('[aria-selected="true"]')
        if (!menu || !viewport || !option) return
        const bounds = viewport.getBoundingClientRect()
        const rect = option.getBoundingClientRect()
        if (rect.top < bounds.top) viewport.scrollTop -= bounds.top - rect.top
        else if (rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom
    }, [menu, active])
    if (!editor) return null
    const filtered = availableBlocks.filter((block) =>
        block.label.toLowerCase().includes(menu?.query.toLowerCase() ?? '')
    )
    return (
        <div className="journal-editor" ref={host}>
            <EditorContent editor={editor} />
            {bar && !readOnly && (
                <div
                    className="journal-format-bar"
                    role="toolbar"
                    aria-label="Text formatting"
                    style={{ left: bar.x, top: bar.y }}
                >
                    {[
                        { mark: 'bold', label: 'Bold', icon: Bold },
                        { mark: 'italic', label: 'Italic', icon: Italic },
                        { mark: 'strike', label: 'Strikethrough', icon: Strikethrough },
                        { mark: 'code', label: 'Inline code', icon: Code }
                    ].map(({ mark, label: name, icon: Icon }) => (
                        <Button
                            key={mark}
                            variant="ghost"
                            size="sm"
                            aria-label={name}
                            aria-pressed={editor.isActive(mark)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => editor.chain().focus().toggleMark(mark).run()}
                        >
                            <Icon size={16} aria-hidden="true" />
                        </Button>
                    ))}
                    <Popover
                        open={linkOpen}
                        onOpenChange={(open) => {
                            setLinkOpen(open)
                            if (open) setLinkURL(String(editor.getAttributes('link').href ?? ''))
                        }}
                    >
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Edit link"
                                onMouseDown={(event) => event.preventDefault()}
                            >
                                <Link size={16} aria-hidden="true" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent aria-label="Edit text link">
                            <form
                                className="journal-link-form"
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    if (!validLink) return
                                    if (linkURL) editor.chain().focus().setLink({ href: linkURL }).run()
                                    else editor.chain().focus().unsetLink().run()
                                    setLinkOpen(false)
                                }}
                            >
                                <Input
                                    label="Link URL"
                                    value={linkURL}
                                    onChange={(event) => setLinkURL(event.target.value)}
                                    error={validLink ? undefined : 'Use a web, email, phone, or relative link.'}
                                />
                                <Button size="sm" type="submit" disabled={!validLink}>
                                    {linkURL ? 'Apply link' : 'Remove link'}
                                </Button>
                            </form>
                        </PopoverContent>
                    </Popover>
                </div>
            )}
            {menu && (
                <Popover
                    open
                    onOpenChange={(open) => {
                        if (!open) {
                            menuRef.current = undefined
                            setMenu(undefined)
                        }
                    }}
                >
                    <PopoverAnchor asChild>
                        <span
                            aria-hidden="true"
                            className="journal-menu-anchor"
                            style={{ left: menu.x, top: menu.y, height: menu.height }}
                        />
                    </PopoverAnchor>
                    <PopoverContent
                        ref={menuElement}
                        className="ws-block-menu"
                        id={`${id}-blocks`}
                        role="listbox"
                        aria-label="Formatting blocks"
                        collisionBoundary={host.current?.closest('[role="region"]') ?? undefined}
                        collisionPadding={8}
                        sideOffset={8}
                        onOpenAutoFocus={(event) => event.preventDefault()}
                        onCloseAutoFocus={(event) => event.preventDefault()}
                        onInteractOutside={(event) => {
                            if (event.target instanceof window.Node && host.current?.contains(event.target))
                                event.preventDefault()
                        }}
                    >
                        <ScrollArea
                            className="ws-block-options"
                            label="Formatting options"
                            maxHeight="min(320px, calc(var(--radix-popover-content-available-height) - var(--space-4) - 2px))"
                            viewportRef={menuViewport}
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
                                        onPointerMove={() => {
                                            activeRef.current = index
                                            setActive(index)
                                        }}
                                        onClick={() => apply(editor, block.id)}
                                    >
                                        <block.icon size={16} aria-hidden="true" />
                                        <span>{block.label}</span>
                                    </button>
                                ))
                            ) : (
                                <p className="ws-block-empty">No matching formats</p>
                            )}
                        </ScrollArea>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    )
}
