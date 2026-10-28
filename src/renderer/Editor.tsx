import { EmojiPicker } from './EmojiPicker'
import { findEmoji, readEmojiHistory, recordEmoji, type EmojiCategory, type EmojiUse } from './emoji-catalog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import {
    memo,
    useEffect,
    useEffectEvent,
    useId,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type { Ref } from 'react'
import { flushSync } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { journalExtensions } from './journal-extensions'
import { applyBlockFormat } from './block-format'
import './journal-editor.css'
import type { JournalNode } from '../shared/model'
import { editorSnapshot, type EditorSnapshot } from './editor-snapshot'
import { attachImageDrop } from './image-drop'
import { useToastStack } from './components/arc/toast-stack/toast-stack'
import { ImageImports, imageImportKey, type ImageImportJob } from './journal-images'
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
    BookTemplate,
    ImagePlus,
    Smile
} from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Input } from './components/arc/input/input'
import { Popover, PopoverAnchor, PopoverTrigger, PopoverContent } from './components/arc/popover/popover'
import { markdownToHtml } from './components/arc/rich-text-editor/rich-text-editor'

const imageImportFailure =
    'Use a still PNG, JPEG, WebP, or self-contained SVG under 5 MB and 40 million pixels, then try again.'

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
    { id: 'code', label: 'Code block', icon: FileCode },
    { id: 'emoji', label: 'Emoji', icon: Smile }
]
function blockQuery(query: string) {
    const turn = /^turn(?:\s*into)?\s*/i.exec(query)
    const search = (turn ? query.slice(turn[0].length) : query).trim().toLowerCase()
    const aliases: Record<string, string> = {
        h1: 'heading 1',
        h2: 'heading 2',
        h3: 'heading 3',
        h4: 'heading 4',
        heading1: 'heading 1',
        heading2: 'heading 2',
        heading3: 'heading 3',
        heading4: 'heading 4',
        plain: 'text',
        todo: 'checklist',
        num: 'numbered list'
    }
    return { convert: !!turn, search: aliases[search] ?? search }
}

interface Menu {
    emoji?: boolean
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
    insertBlock: (block: JournalNode) => void
}

export const Editor = memo(function Editor({
    value,
    onChange,
    onEdit,
    readOnly = false,
    autoFocus = false,
    insertLink,
    ref,
    label,
    onHistoryChange,
    template,
    restoreId,
    allowImageImport = true,
    onImagesReadyChange
}: {
    value: JournalNode
    onChange?: (body: JournalNode) => void
    onEdit?: (snapshot: EditorSnapshot) => void
    readOnly?: boolean
    autoFocus?: boolean
    insertLink?: { url: string; title: string; nonce: number }
    ref?: Ref<EditorHandle>
    label?: string
    template?: JournalNode
    onHistoryChange?: (history: { canUndo: boolean; canRedo: boolean }) => void
    restoreId?: string
    allowImageImport?: boolean
    onImagesReadyChange?: (ready: boolean) => void
}) {
    const imports = useRef<ImageImports | undefined>(undefined)
    const [imageJobs, setImageJobs] = useState<ImageImportJob[]>([])
    const [dropGuide, setDropGuide] = useState<number>()
    const { toast } = useToastStack()
    const reportImageError = useEffectEvent((message: string) =>
        toast({ type: 'error', title: 'Could not import image', description: message, duration: Infinity })
    )
    const canImportImages = allowImageImport && !readOnly
    const availableBlocks = useMemo(
        () => [
            ...blocks,
            ...(canImportImages ? [{ id: 'image', label: 'Image', icon: ImagePlus }] : []),
            ...(template ? [{ id: 'template', label: 'Use entry template', icon: BookTemplate }] : [])
        ],
        [template, canImportImages]
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
    const [emojiCategory, setEmojiCategory] = useState<EmojiCategory>('all')
    const emojiCategoryRef = useRef<EmojiCategory>('all')
    const [emojiHistory, setEmojiHistory] = useState<EmojiUse[]>([])
    const emojiHistoryRef = useRef<EmojiUse[]>([])
    useEffect(() => {
        const history = readEmojiHistory()
        emojiHistoryRef.current = history
        setEmojiHistory(history)
    }, [])
    const emojiResults = useMemo(
        () => findEmoji(menu?.query ?? '', emojiCategory, emojiHistory),
        [menu?.query, emojiCategory, emojiHistory]
    )
    const [active, setActive] = useState(0)
    const activeRef = useRef(0)
    const host = useRef<HTMLDivElement>(null)
    const id = useId()
    const updateMenu = (editor: TiptapEditor) => {
        const { $from, empty, from } = editor.state.selection
        if (!empty && !readOnly && !$from.parent.type.spec.code && editor.state.selection instanceof TextSelection) {
            const rect = host.current?.getBoundingClientRect()
            const coords = editor.view.coordsAtPos(from)
            setBar({
                x: Math.max(0, Math.min((rect?.width ?? 300) - 260, coords.left - (rect?.left ?? 0))),
                y: coords.top - (rect?.top ?? 0) - 44
            })
        } else setBar(undefined)
        const prefix = $from.parent.textBetween(0, $from.parentOffset, '\n')
        const colon = /(?:^|\s):([\p{L}\p{N}_+-]*)$/u.exec(prefix)
        const match = empty && !readOnly && !$from.parent.type.spec.code ? (colon ?? /\/([^/]*)$/.exec(prefix)) : null
        if (!match) {
            menuRef.current = undefined
            setMenu(undefined)
            return
        }
        if (colon && (!menuRef.current?.emoji || menuRef.current.from !== from - match[1].length - 1)) {
            emojiCategoryRef.current = 'all'
            setEmojiCategory('all')
        }
        const rect = host.current?.getBoundingClientRect()
        const coords = editor.view.coordsAtPos(from)
        const next = {
            emoji: !!colon,
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
        if (block === 'emoji') {
            editor
                .chain()
                .focus()
                .insertContentAt({ from: current.from, to: current.to }, { type: 'text', text: ':' })
                .run()
            return
        } else if (block === 'image') {
            flushSync(() => {
                editor.commands.deleteRange(current)
                menuRef.current = undefined
                setMenu(undefined)
            })
            const manager = imports.current
            editor.view.dom.blur()
            manager?.choose(async () => {
                try {
                    if (!window.journal.images) throw new Error('Reopen the app to enable image import.')
                    return await window.journal.images.choose(restoreId)
                } catch {
                    throw new Error(imageImportFailure)
                } finally {
                    if (!editor.isDestroyed && imports.current === manager) editor.view.focus()
                }
            })
        } else if (block === 'template') {
            if (template)
                editor
                    .chain()
                    .focus()
                    .deleteRange(current)
                    .insertContent(structuredClone(template.content ?? []))
                    .run()
        } else applyBlockFormat(editor, block, current, blockQuery(current.query).convert)
        menuRef.current = undefined
        setMenu(undefined)
    }
    const insertEmoji = (target: TiptapEditor, emoji: string) => {
        const current = menuRef.current
        if (!current || readOnly) return
        const history = recordEmoji(emojiHistoryRef.current, emoji)
        emojiHistoryRef.current = history
        setEmojiHistory(history)
        menuRef.current = undefined
        setMenu(undefined)
        target
            .chain()
            .focus()
            .insertContentAt({ from: current.from, to: current.to }, { type: 'text', text: emoji })
            .run()
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
                const files = Array.from(clipboard?.files ?? [])
                if (files.length && canImportImages && imports.current) {
                    event.preventDefault()
                    imports.current.add(files)
                    return true
                }
                const text = clipboard?.getData('text/plain') ?? ''
                const { $from, $to } = _view.state.selection
                if ($from.parent.type.spec.code) {
                    // A code-local paste is literal. Replacing several blocks must
                    // retain their HTML structure instead of flattening into code.
                    const html = clipboard?.getData('text/html')
                    if (!$from.sameParent($to) && html && editorRef.current && !readOnly) {
                        editorRef.current.commands.insertContent(html, { parseOptions: { preserveWhitespace: 'full' } })
                        return true
                    }
                    return false
                }
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
                if (event.isComposing || _view.composing) return false
                const current = menuRef.current
                if (!current || !editorRef.current) return false
                const filtered = availableBlocks.filter(
                    (block) =>
                        (!blockQuery(current.query).convert || !['template', 'image', 'emoji'].includes(block.id)) &&
                        block.label.toLowerCase().includes(blockQuery(current.query).search)
                )
                if (current.emoji && event.key !== 'Escape') {
                    const results = findEmoji(current.query, emojiCategoryRef.current, emojiHistoryRef.current)
                    const movement: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }
                    if (movement[event.key] && results.length) {
                        activeRef.current = (activeRef.current + movement[event.key] + results.length) % results.length
                        setActive(activeRef.current)
                        return true
                    }
                    if (['Enter', 'Tab'].includes(event.key) && results[activeRef.current]) {
                        insertEmoji(editorRef.current, results[activeRef.current].emoji)
                        return true
                    }
                    return false
                }
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
            const snapshot = editorSnapshot(updated.state.doc)
            if (onEdit) onEdit(snapshot)
            if (onChange) {
                const body = snapshot.read()
                emitted.current = body
                onChange(body)
            }
            updateMenu(updated)
        },
        onTransaction: ({ editor: updated }) => {
            imports.current?.sync()
            onHistoryChange?.({ canUndo: updated.can().undo(), canRedo: updated.can().redo() })
        },
        onSelectionUpdate: ({ editor: updated }) => updateMenu(updated)
    })
    useEffect(() => {
        if (!editor || !canImportImages) return
        const manager = new ImageImports(
            editor,
            async (bytes) => {
                if (!window.journal.images) throw new Error('Reopen the app to enable image import.')
                try {
                    return await window.journal.images.import(bytes, restoreId)
                } catch {
                    throw new Error(imageImportFailure)
                }
            },
            setImageJobs,
            (message) => reportImageError(message)
        )
        imports.current = manager
        const element = host.current
        const detach = element
            ? attachImageDrop(
                  editor.view,
                  element.closest<HTMLElement>('[data-journal-drop-zone]') ?? element,
                  element,
                  (files, position) => manager.add(files, position),
                  setDropGuide
              )
            : undefined
        return () => {
            detach?.()
            imports.current = undefined
            manager.dispose()
            if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(imageImportKey, { cancel: true }))
        }
    }, [editor, canImportImages, restoreId])
    useEffect(() => {
        onImagesReadyChange?.(imageJobs.length === 0)
    }, [imageJobs.length, onImagesReadyChange])
    useEffect(() => () => onImagesReadyChange?.(true), [onImagesReadyChange])
    const initiallyFocused = useRef(false)
    useEffect(() => {
        if (!autoFocus || !editor || readOnly || initiallyFocused.current) return
        initiallyFocused.current = true
        editor.commands.focus('end', { scrollIntoView: false })
    }, [autoFocus, editor, readOnly])
    useImperativeHandle(
        ref,
        () => ({
            undo: () => {
                if (editor && imageImportKey.getState(editor.state)?.find().length) {
                    editor.view.dispatch(editor.state.tr.setMeta(imageImportKey, { cancel: true }))
                    return
                }
                editor?.commands.undo()
            },
            redo: () => {
                editor?.commands.redo()
            },
            insertBlock: (block) => {
                if (editor?.isEditable)
                    editor.commands.insertContentAt(editor.state.doc.content.size, block, { updateSelection: false })
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
                  'aria-controls': menu.emoji ? `${id}-emoji-options` : `${id}-blocks`,
                  ...(menu.emoji && !emojiResults.length ? {} : { 'aria-activedescendant': `${id}-block-${active}` })
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
    }, [editor, menu, id, active, readOnly, label, emojiResults.length])
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
    const filtered = availableBlocks.filter(
        (block) =>
            (!blockQuery(menu?.query ?? '').convert || !['template', 'image', 'emoji'].includes(block.id)) &&
            block.label.toLowerCase().includes(blockQuery(menu?.query ?? '').search)
    )
    return (
        <div className="journal-editor" ref={host}>
            {dropGuide !== undefined && (
                <div className="journal-image-drop-guide" style={{ top: dropGuide }} aria-hidden="true" />
            )}
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
                        className={menu.emoji ? 'ws-block-menu journal-emoji-menu' : 'ws-block-menu'}
                        id={`${id}-blocks`}
                        role={menu.emoji ? 'dialog' : 'listbox'}
                        aria-label={
                            menu.emoji ? 'Choose emoji' : blockQuery(menu.query).convert ? 'Turn into' : 'Add blocks'
                        }
                        collisionBoundary={
                            menu.emoji ? undefined : (host.current?.closest('[role="region"]') ?? undefined)
                        }
                        collisionPadding={8}
                        sideOffset={8}
                        onOpenAutoFocus={(event) => event.preventDefault()}
                        onCloseAutoFocus={(event) => event.preventDefault()}
                        onInteractOutside={(event) => {
                            if (event.target instanceof window.Node && host.current?.contains(event.target))
                                event.preventDefault()
                        }}
                    >
                        {menu.emoji ? (
                            <EmojiPicker
                                results={emojiResults}
                                category={emojiCategory}
                                active={active}
                                id={id}
                                onCategory={(category) => {
                                    emojiCategoryRef.current = category
                                    setEmojiCategory(category)
                                    activeRef.current = 0
                                    setActive(0)
                                }}
                                onReturnToEditor={() => editor.view.focus()}
                                onChoose={(emoji) => insertEmoji(editor, emoji)}
                            />
                        ) : (
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
                                            <span>
                                                {blockQuery(menu.query).convert
                                                    ? `Turn into ${block.label.toLowerCase()}`
                                                    : block.label}
                                            </span>
                                        </button>
                                    ))
                                ) : (
                                    <p className="ws-block-empty">No matching formats</p>
                                )}
                            </ScrollArea>
                        )}
                    </PopoverContent>
                </Popover>
            )}
        </div>
    )
})
