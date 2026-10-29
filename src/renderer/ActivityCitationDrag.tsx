import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
    DndContext,
    DragOverlay,
    MouseSensor,
    TouchSensor,
    pointerWithin,
    useDroppable,
    useSensor,
    useSensors,
    defaultDropAnimation,
    type Modifier
} from '@dnd-kit/core'
import { useReducedMotion } from 'motion/react'
import type { Activity, Repository } from '../shared/model'
import { ActivityCitationCard } from './ActivityCitationCard'
import { motionTokens } from './components/arc/motion-tokens'

const writingTarget = 'writing-citation-target'

// Keep the card close to the pickup point without letting the list's row width
// or its clipping/scrolling affect the overlay. Movement follows input directly.
const anchorToPointer: Modifier = ({ transform, activatorEvent, activeNodeRect, overlayNodeRect, windowRect }) => {
    const point =
        activatorEvent instanceof MouseEvent
            ? activatorEvent
            : activatorEvent instanceof TouchEvent
              ? activatorEvent.touches[0]
              : undefined
    if (!point || !activeNodeRect) return transform
    let x = transform.x + point.clientX - activeNodeRect.left - 24
    let y = transform.y + point.clientY - activeNodeRect.top - 24
    if (overlayNodeRect && windowRect) {
        x = Math.max(
            8 - activeNodeRect.left,
            Math.min(x, windowRect.width - overlayNodeRect.width - activeNodeRect.left - 8)
        )
        y = Math.max(
            8 - activeNodeRect.top,
            Math.min(y, windowRect.height - overlayNodeRect.height - activeNodeRect.top - 8)
        )
    }
    return { ...transform, x, y }
}
const overlayModifiers = [anchorToPointer]

export function ActivityCitationDrag({
    scope,
    activities,
    repositories,
    enabled,
    onCite,
    children
}: {
    scope: string
    activities: Activity[]
    repositories: Repository[]
    enabled: boolean
    onCite: (activity: Activity) => void
    children: ReactNode
}) {
    const [portal, setPortal] = useState<HTMLElement | null>(null)
    useEffect(() => setPortal(document.body), [])
    const [active, setActive] = useState<Activity>()
    const [overWriting, setOverWriting] = useState(false)
    useEffect(() => {
        if (!active) return
        // Let the sensor receive Escape, but consume it before the app's
        // window shortcut interprets the same key as navigation to the hub.
        const consumeEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') event.preventDefault()
        }
        document.addEventListener('keydown', consumeEscape, true)
        document.body.classList.add('citation-dragging')
        return () => {
            document.removeEventListener('keydown', consumeEscape, true)
            document.body.classList.remove('citation-dragging')
        }
    }, [active])

    const delivered = useRef(false)
    const pickupScope = useRef(scope)
    const reduced = useReducedMotion()
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
    )
    const reset = () => {
        setActive(undefined)
        setOverWriting(false)
    }
    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            autoScroll={false}
            accessibility={{
                announcements: {
                    onDragStart: () => 'Activity picked up. Move to your writing to cite it. Escape cancels.',
                    onDragOver: ({ over }) =>
                        over?.id === writingTarget ? 'Release to cite in your writing.' : 'Outside the writing area.',
                    onDragEnd: () => (delivered.current ? 'Activity cited in your writing.' : 'Citation cancelled.'),
                    onDragCancel: () => 'Citation cancelled.'
                }
            }}
            onDragStart={({ active: item }) => {
                delivered.current = false
                pickupScope.current = scope
                if (enabled) setActive(activities.find((activity) => activity.id === item.id))
            }}
            onDragOver={({ over }) => setOverWriting(enabled && over?.id === writingTarget)}
            onDragCancel={reset}
            onDragEnd={({ active: item, over }) => {
                const activity = activities.find((activity) => activity.id === item.id)
                if (enabled && activity && pickupScope.current === scope && over?.id === writingTarget) {
                    delivered.current = true
                    onCite(activity)
                }
                reset()
            }}
        >
            {children}
            {portal &&
                createPortal(
                    <DragOverlay
                        className="activity-citation-overlay"
                        zIndex={100}
                        modifiers={overlayModifiers}
                        style={{ width: 'min(304px, calc(100vw - 16px))', height: 'auto', pointerEvents: 'none' }}
                        dropAnimation={{
                            duration: motionTokens.duration.fast * 1000,
                            easing: `cubic-bezier(${motionTokens.ease.standard.join(',')})`,
                            keyframes: (args) => {
                                if (!delivered.current && !reduced) return defaultDropAnimation.keyframes(args)
                                const { x, y, scaleX, scaleY } = args.transform.initial
                                const transform = `translate3d(${x}px, ${y}px, 0) scale(${scaleX}, ${scaleY})`
                                return [
                                    { transform, opacity: 1 },
                                    { transform, opacity: 0 }
                                ]
                            }
                        }}
                    >
                        {active && (
                            <div aria-hidden="true">
                                <ActivityCitationCard
                                    activity={active}
                                    repositoryName={
                                        repositories.find((repository) => repository.id === active.repositoryId)
                                            ?.name ?? 'Repository'
                                    }
                                    ready={overWriting}
                                />
                            </div>
                        )}
                    </DragOverlay>,
                    portal
                )}
        </DndContext>
    )
}

export function CitationWritingTarget({ enabled, children }: { enabled: boolean; children: ReactNode }) {
    const { setNodeRef, isOver, active } = useDroppable({ id: writingTarget, disabled: !enabled })
    return (
        <div ref={setNodeRef} className="ws-draft-host" data-citation-over={isOver || undefined}>
            {children}
            {enabled && active && (
                <div className="citation-writing-cue" aria-hidden="true">
                    <span>{isOver ? 'Release to cite' : 'Drop an activity here to cite it'}</span>
                </div>
            )}
        </div>
    )
}
