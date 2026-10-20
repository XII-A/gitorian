/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The scrollable image region needs keyboard focus for zoom and navigation. */
import * as Modal from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Minus, Plus, Minimize2, X } from 'lucide-react'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'
import { imageURL } from '../shared/images'

export interface LightboxImage {
    assetId: string
    alt: string
}
export function ImageLightbox({
    images,
    initialIndex,
    close,
    restoreFocus,
    download
}: {
    images: LightboxImage[]
    initialIndex: number
    close: () => void
    restoreFocus: (index: number) => void
    download: (id: string) => void
}) {
    const [index, setIndex] = useState(initialIndex)
    const [zoom, setZoom] = useState<number | null>(null)
    const [natural, setNatural] = useState({ width: 0, height: 0 })
    const [size, setSize] = useState({ width: 0, height: 0 })
    const content = useRef<HTMLDivElement>(null)
    const stage = useRef<HTMLDivElement>(null)
    const dragging = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)
    const image = images[index]
    const fit =
        natural.width && size.width
            ? Math.min(1, Math.max(1, size.width - 48) / natural.width, Math.max(1, size.height - 160) / natural.height)
            : 1
    const scale = zoom ?? fit
    useEffect(() => {
        const host = content.current
        if (!host) return
        const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight })
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(measure)
        observer.observe(host)
        return () => observer.disconnect()
    }, [])
    const select = (next: number) => {
        if (next < 0 || next >= images.length) return
        setIndex(next)
        setZoom(null)
        setNatural({ width: 0, height: 0 })
        stage.current?.scrollTo(0, 0)
    }
    const changeZoom = (delta: number) => setZoom(Math.min(8, Math.max(0.1, scale + delta)))
    return (
        <Modal.Root
            open
            onOpenChange={(open) => {
                if (!open) close()
            }}
        >
            <Modal.Portal>
                <Modal.Overlay className="journal-lightbox-backdrop" />
                <Modal.Content
                    ref={content}
                    className="journal-lightbox"
                    aria-describedby={undefined}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        stage.current?.focus()
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        restoreFocus(index)
                    }}
                    onKeyDown={(event) => {
                        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
                        if (event.key === 'ArrowLeft') select(index - 1)
                        else if (event.key === 'ArrowRight') select(index + 1)
                        else if (event.key === '+' || event.key === '=') changeZoom(0.25)
                        else if (event.key === '-') changeZoom(-0.25)
                        else if (event.key === '0') setZoom(null)
                        else return
                        event.preventDefault()
                    }}
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) close()
                    }}
                >
                    <Modal.Title className="sr-only">Image viewer</Modal.Title>
                    <div
                        ref={stage}
                        className="journal-lightbox-stage"
                        role="region"
                        tabIndex={0}
                        aria-label="Image. Use plus and minus to zoom, arrow keys to navigate, and Escape to close."
                        data-zoomed={scale > fit || undefined}
                        onDoubleClick={() => setZoom(zoom === null ? 1 : null)}
                        onPointerDown={(event) => {
                            if (scale <= fit || !stage.current || event.button !== 0) return
                            dragging.current = {
                                x: event.clientX,
                                y: event.clientY,
                                left: stage.current.scrollLeft,
                                top: stage.current.scrollTop
                            }
                            event.currentTarget.setPointerCapture(event.pointerId)
                        }}
                        onPointerMove={(event) => {
                            const drag = dragging.current
                            if (drag && stage.current) {
                                stage.current.scrollLeft = drag.left + drag.x - event.clientX
                                stage.current.scrollTop = drag.top + drag.y - event.clientY
                            }
                        }}
                        onPointerUp={() => {
                            dragging.current = undefined
                        }}
                        onPointerCancel={() => {
                            dragging.current = undefined
                        }}
                    >
                        <img
                            key={`${image.assetId}-${index}`}
                            src={imageURL(image.assetId)}
                            alt={image.alt}
                            draggable={false}
                            style={
                                natural.width
                                    ? { width: natural.width * scale, height: natural.height * scale }
                                    : undefined
                            }
                            onLoad={(event) =>
                                setNatural({
                                    width: event.currentTarget.naturalWidth,
                                    height: event.currentTarget.naturalHeight
                                })
                            }
                        />
                    </div>
                    <div className="journal-lightbox-controls">
                        {images.length > 1 && (
                            <FloatingButtonGroup
                                label="Browse images"
                                variant="floating"
                                iconOnly
                                items={[
                                    {
                                        id: 'previous',
                                        label: 'Previous image',
                                        icon: <ArrowLeft />,
                                        disabled: index === 0,
                                        onSelect: () => select(index - 1)
                                    },
                                    {
                                        id: 'next',
                                        label: 'Next image',
                                        icon: <ArrowRight />,
                                        disabled: index === images.length - 1,
                                        onSelect: () => select(index + 1)
                                    }
                                ]}
                            />
                        )}
                        <FloatingButtonGroup
                            label="Image zoom"
                            variant="floating"
                            items={[
                                {
                                    id: 'out',
                                    label: 'Zoom out',
                                    icon: <Minus />,
                                    iconOnly: true,
                                    disabled: scale <= 0.1,
                                    onSelect: () => changeZoom(-0.25)
                                },
                                {
                                    id: 'zoom',
                                    label: `${Math.round(scale * 100)}%`,
                                    reserveLabels: ['100%'],
                                    onSelect: () => setZoom(1)
                                },
                                {
                                    id: 'in',
                                    label: 'Zoom in',
                                    icon: <Plus />,
                                    iconOnly: true,
                                    disabled: scale >= 8,
                                    onSelect: () => changeZoom(0.25)
                                },
                                {
                                    id: 'fit',
                                    label: 'Fit image',
                                    icon: <Minimize2 />,
                                    iconOnly: true,
                                    onSelect: () => setZoom(null)
                                }
                            ]}
                        />
                        <FloatingButtonGroup
                            label="Image viewer actions"
                            variant="floating"
                            iconOnly
                            items={[
                                {
                                    id: 'download',
                                    label: 'Download image',
                                    icon: <Download />,
                                    onSelect: () => download(image.assetId)
                                },
                                { id: 'close', label: 'Close image viewer', icon: <X />, onSelect: close }
                            ]}
                        />
                    </div>
                    <span className="sr-only" role="status">
                        Image {index + 1} of {images.length}
                    </span>
                </Modal.Content>
            </Modal.Portal>
        </Modal.Root>
    )
}
