import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import type { JournalNode } from '../shared/model'
import { Button } from './components/arc/button/button'

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
    const [linkUrl, setLinkUrl] = useState('')
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                horizontalRule: false,
                link: { openOnClick: false }
            }),
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
            }
        },
        onUpdate: ({ editor: updated }) => {
            onChange?.(updated.getJSON() as JournalNode)
        }
    })
    useEffect(() => {
        if (readOnly && editor) editor.commands.setContent(value)
    }, [value, editor, readOnly])
    useEffect(() => {
        editor?.setEditable(!readOnly)
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
    if (!editor) return null
    return (
        <div className="journal-editor">
            {!readOnly && (
                <div className="editor-toolbar" aria-label="Formatting">
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Bold"
                        aria-pressed={editor.isActive('bold')}
                        onClick={() => {
                            editor.chain().focus().toggleBold().run()
                        }}
                    >
                        B
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Italic"
                        aria-pressed={editor.isActive('italic')}
                        onClick={() => {
                            editor.chain().focus().toggleItalic().run()
                        }}
                    >
                        <em>I</em>
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Underline"
                        onClick={() => {
                            editor.chain().focus().toggleUnderline().run()
                        }}
                    >
                        U
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Strikethrough"
                        onClick={() => {
                            editor.chain().focus().toggleStrike().run()
                        }}
                    >
                        S̶
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Heading"
                        onClick={() => {
                            editor.chain().focus().toggleHeading({ level: 2 }).run()
                        }}
                    >
                        H2
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Bullet list"
                        onClick={() => {
                            editor.chain().focus().toggleBulletList().run()
                        }}
                    >
                        List
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Numbered list"
                        onClick={() => {
                            editor.chain().focus().toggleOrderedList().run()
                        }}
                    >
                        1.
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Checkbox list"
                        onClick={() => {
                            editor.chain().focus().toggleTaskList().run()
                        }}
                    >
                        ☑
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Quote"
                        onClick={() => {
                            editor.chain().focus().toggleBlockquote().run()
                        }}
                    >
                        Quote
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Code block"
                        onClick={() => {
                            editor.chain().focus().toggleCodeBlock().run()
                        }}
                    >
                        {'</>'}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Inline code"
                        onClick={() => {
                            editor.chain().focus().toggleCode().run()
                        }}
                    >
                        Code
                    </Button>
                    <label className="sr-only" htmlFor="editor-link">
                        Link URL
                    </label>
                    <input
                        id="editor-link"
                        aria-label="Link URL"
                        placeholder="https://…"
                        value={linkUrl}
                        onChange={(event) => {
                            setLinkUrl(event.target.value)
                        }}
                        style={{ width: 130 }}
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!/^https?:\/\//.test(linkUrl)}
                        onClick={() => {
                            editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
                            setLinkUrl('')
                        }}
                    >
                        Link
                    </Button>
                </div>
            )}
            <EditorContent editor={editor} />
        </div>
    )
}
