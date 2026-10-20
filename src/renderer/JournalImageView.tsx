import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NodeViewWrapper, useEditorState } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Captions, Download, Expand, MoreHorizontal, Trash2 } from 'lucide-react'
import { imageURL } from '../shared/images'
import { Button } from './components/arc/button/button'
import { DropdownMenu } from './components/arc/dropdown-menu/dropdown-menu'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'
import { useToastStack } from './components/arc/toast-stack/toast-stack'
import { ImageLightbox, type LightboxImage } from './ImageLightbox'

export function JournalImageView({ node, editor, updateAttributes, deleteNode, selected, getPos }: NodeViewProps) {
    const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable })
    const [failed, setFailed] = useState(false)
    const [captionOpen, setCaptionOpen] = useState(false)
    const [compact, setCompact] = useState(true)
    const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number }>()
    const frame = useRef<HTMLDivElement>(null)
    const preview = useRef<HTMLButtonElement>(null)
    const caption = useRef<HTMLTextAreaElement>(null)
    const { toast } = useToastStack()
    const alt = String(node.attrs.alt ?? '')
    const assetId = String(node.attrs.assetId)
    const url = imageURL(assetId)
    useEffect(() => {
        setFailed(false)
    }, [url])
    useLayoutEffect(() => {
        const element = frame.current
        if (!element) return
        const measure = () => setCompact(element.getBoundingClientRect().width < 240)
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
        const field = caption.current
        const element = frame.current
        if (!field || !element) return
        const measure = () => {
            field.style.height = '0px'
            field.style.height = `${Math.max(24, field.scrollHeight)}px`
        }
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [alt, captionOpen, selected])
    useEffect(() => {
        if (captionOpen) caption.current?.focus()
    }, [captionOpen])
    const open = () => {
        const images: LightboxImage[] = []
        let index = 0
        editor.state.doc.descendants((item, position) => {
            if (item.type.name !== 'image') return
            if (position === getPos()) index = images.length
            images.push({ assetId: String(item.attrs.assetId), alt: String(item.attrs.alt ?? '') })
        })
        setLightbox({ images, index })
    }
    const download = (id: string) => {
        void window.journal.images?.save(id).catch(() =>
            toast({
                type: 'error',
                title: 'Could not download image',
                description: 'Check that the image is available, then try downloading it again.',
                duration: Infinity
            })
        )
    }
    const remove = () => {
        deleteNode()
        editor.commands.focus()
    }
    const items = [
        { id: 'preview', label: 'Enlarge image', icon: <Expand />, onSelect: open },
        ...(editable
            ? [{ id: 'caption', label: 'Edit caption', icon: <Captions />, onSelect: () => setCaptionOpen(true) }]
            : []),
        { id: 'download', label: 'Download image', icon: <Download />, onSelect: () => download(assetId) },
        ...(editable
            ? [{ id: 'remove', label: 'Remove image', icon: <Trash2 />, onSelect: remove, destructive: true }]
            : [])
    ]
    return (
        <NodeViewWrapper className="journal-image" data-selected={selected || undefined} contentEditable={false}>
            <div className="journal-image-frame" ref={frame}>
                <button
                    ref={preview}
                    type="button"
                    className="journal-image-preview"
                    aria-label={alt ? `Enlarge image: ${alt}` : 'Enlarge image'}
                    onClick={open}
                >
                    {failed ? (
                        <span>Image unavailable. Restore it from a backup.</span>
                    ) : (
                        <img src={url} alt={alt} loading="lazy" draggable={false} onError={() => setFailed(true)} />
                    )}
                </button>
                <div className="journal-image-tools" data-compact={compact || undefined}>
                    {compact ? (
                        <DropdownMenu
                            label="Image actions"
                            items={items}
                            trigger={
                                <Button variant="secondary" size="sm" aria-label="Image actions">
                                    <MoreHorizontal size={16} aria-hidden="true" />
                                </Button>
                            }
                        />
                    ) : (
                        <FloatingButtonGroup
                            label="Image actions"
                            variant="floating"
                            size="sm"
                            iconOnly
                            items={items}
                        />
                    )}
                </div>
                {editable && (alt || captionOpen || selected) ? (
                    <textarea
                        ref={caption}
                        className="journal-image-caption"
                        aria-label="Image caption"
                        placeholder="Add a caption"
                        rows={1}
                        value={alt}
                        maxLength={2000}
                        onChange={(event) => updateAttributes({ alt: event.target.value })}
                        onBlur={() => setCaptionOpen(false)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault()
                                setCaptionOpen(false)
                                preview.current?.focus()
                            }
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                const position = getPos()
                                if (typeof position !== 'number') return
                                const end = position + node.nodeSize
                                if (!editor.state.doc.nodeAt(end)?.isTextblock)
                                    editor.commands.insertContentAt(end, { type: 'paragraph' })
                                editor
                                    .chain()
                                    .focus()
                                    .setTextSelection(end + 1)
                                    .run()
                            }
                        }}
                    />
                ) : (
                    !!alt && <p className="journal-image-caption">{alt}</p>
                )}
            </div>
            {lightbox && (
                <ImageLightbox
                    images={lightbox.images}
                    initialIndex={lightbox.index}
                    close={() => setLightbox(undefined)}
                    download={download}
                    restoreFocus={(index) => {
                        const target =
                            editor.view.dom.querySelectorAll<HTMLButtonElement>('.journal-image-preview')[index]
                        ;(target ?? preview.current)?.focus()
                    }}
                />
            )}
        </NodeViewWrapper>
    )
}
