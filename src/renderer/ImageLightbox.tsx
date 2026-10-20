/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The scrollable image region needs keyboard focus for zoom and navigation. */
import * as Modal from '@radix-ui/react-dialog'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Download, Minus, Plus, Minimize2, X } from 'lucide-react'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'
import { imageURL } from '../shared/images'

const maxZoom = 2

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
    const stage = useRef<HTMLDivElement>(null)
    const displayedImage = useRef<HTMLImageElement>(null)
    const dragging = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)
    const dragged = useRef(false)
    const anchor = useRef<{ x: number; y: number; fractionX: number; fractionY: number } | undefined>(undefined)
    const image = images[index]
    const fit =
        natural.width && size.width && size.height
            ? Math.min(1, size.width / natural.width, size.height / natural.height)
            : 1
    const minZoom = fit / 4
    const scale = zoom === null ? fit : Math.max(minZoom, Math.min(maxZoom, zoom))
    // The portal mounts after the parent effect. Observe the actual image viewport on attachment.
    const observeStage = useCallback((host: HTMLDivElement | null) => {
        stage.current = host
        if (!host) return
        const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight })
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(host)
        return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
        const host = stage.current
        if (!host) return
        const point = anchor.current
        if (zoom === null) host.scrollTo(0, 0)
        else if (point) {
            host.scrollLeft = point.fractionX * natural.width * scale - point.x
            host.scrollTop = point.fractionY * natural.height * scale - point.y
        }
        anchor.current = undefined
    }, [scale, zoom, natural])
    const select = (next: number) => {
        if (next < 0 || next >= images.length) return
        anchor.current = undefined
        setIndex(next)
        setZoom(null)
        setNatural({ width: 0, height: 0 })
        stage.current?.scrollTo(0, 0)
    }
    const applyZoom = (next: number | null, point?: { x: number; y: number }) => {
        const host = stage.current
        const img = displayedImage.current
        const target = next === null ? null : Math.min(maxZoom, Math.max(minZoom, next))
        if (target !== null && target === scale) return
        if (host && img && target !== null) {
            const viewport = host.getBoundingClientRect()
            const bounds = img.getBoundingClientRect()
            const x = point?.x ?? viewport.left + viewport.width / 2
            const y = point?.y ?? viewport.top + viewport.height / 2
            if (bounds.width && bounds.height) {
                anchor.current = {
                    x: x - viewport.left,
                    y: y - viewport.top,
                    fractionX: Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)),
                    fractionY: Math.max(0, Math.min(1, (y - bounds.top) / bounds.height))
                }
            }
        } else anchor.current = undefined
        setZoom(target)
    }
    const changeZoom = (factor: number) => applyZoom(scale * factor)
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
                        else if (event.key === '+' || event.key === '=') changeZoom(1.25)
                        else if (event.key === '-') changeZoom(1 / 1.25)
                        else if (event.key === '0') applyZoom(null)
                        else return
                        event.preventDefault()
                    }}
                    onPointerDown={(event) => {
                        if (event.target === event.currentTarget) close()
                    }}
                >
                    <Modal.Title className="sr-only">Image viewer</Modal.Title>
                    <div
                        ref={observeStage}
                        className="journal-lightbox-stage"
                        role="region"
                        tabIndex={0}
                        aria-label="Image. Use plus and minus to zoom, arrow keys to navigate, and Escape to close."
                        data-zoomed={scale > fit || undefined}
                        onClickCapture={(event) => {
                            if (event.detail > 0 && dragged.current) {
                                event.preventDefault()
                                event.stopPropagation()
                            }
                        }}
                        onPointerDown={(event) => {
                            dragged.current = false
                            if (scale <= fit || !stage.current || event.button !== 0) return
                            dragging.current = {
                                x: event.clientX,
                                y: event.clientY,
                                left: stage.current.scrollLeft,
                                top: stage.current.scrollTop
                            }
                        }}
                        onPointerMove={(event) => {
                            const drag = dragging.current
                            if (drag && stage.current) {
                                if (!dragged.current && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4)
                                    return
                                dragged.current = true
                                event.currentTarget.setPointerCapture(event.pointerId)
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
                        onLostPointerCapture={() => {
                            dragging.current = undefined
                        }}
                    >
                        <div className="journal-lightbox-canvas">
                            <button
                                type="button"
                                className="journal-lightbox-image"
                                aria-label={scale > fit ? 'Fit image to screen' : 'Zoom into image'}
                                style={{ width: natural.width * scale, height: natural.height * scale }}
                                onClick={(event) => {
                                    applyZoom(
                                        scale > fit ? null : fit * 2,
                                        event.detail ? { x: event.clientX, y: event.clientY } : undefined
                                    )
                                }}
                            >
                                <img
                                    ref={displayedImage}
                                    key={`${image.assetId}-${index}`}
                                    src={imageURL(image.assetId)}
                                    alt={image.alt}
                                    draggable={false}
                                    onLoad={(event) =>
                                        setNatural({
                                            width: event.currentTarget.naturalWidth,
                                            height: event.currentTarget.naturalHeight
                                        })
                                    }
                                />
                            </button>
                        </div>
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
                                    disabled: scale <= minZoom,
                                    onSelect: () => changeZoom(1 / 1.25)
                                },
                                {
                                    id: 'zoom',
                                    label: `${Math.round(scale * 1000) / 10}%`,
                                    reserveLabels: ['200.0%'],
                                    onSelect: () => applyZoom(1)
                                },
                                {
                                    id: 'in',
                                    label: 'Zoom in',
                                    icon: <Plus />,
                                    iconOnly: true,
                                    disabled: scale >= maxZoom,
                                    onSelect: () => changeZoom(1.25)
                                },
                                {
                                    id: 'fit',
                                    label: 'Fit image',
                                    icon: <Minimize2 />,
                                    iconOnly: true,
                                    onSelect: () => applyZoom(null)
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
