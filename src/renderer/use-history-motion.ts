import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motionTokens } from './components/arc/motion-tokens'

const profile = motionTokens.history
const easing = `cubic-bezier(${profile.ease.join(',')})`
const transform = (x: number) => `translateX(${x}px)`
const position = (element: HTMLElement) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41

/** The two portals share a single WAAPI timeline. Only interaction/resize reads geometry. */
export function useHistoryMotion(open: boolean, reading: boolean, close: () => void) {
    const [present, setPresent] = useState({ drawer: open, reader: reading })
    if (open && !present.drawer) setPresent((value) => ({ ...value, drawer: true }))
    if (reading && !present.reader) setPresent((value) => ({ ...value, reader: true }))
    const drawer = useRef<HTMLDivElement>(null)
    const reader = useRef<HTMLDivElement>(null)
    const overlay = useRef<HTMLDivElement>(null)
    const modality = useRef<'pointer' | 'keyboard'>('pointer')
    const [reduced, setReduced] = useState(false)
    const [revision, update] = useState(0)
    // Radix portals mount in a follow-up layout pass. Wake the controller when
    // their actual DOM nodes arrive, rather than assuming the parent effect sees them.
    const sheetRef = useCallback((node: HTMLDivElement | null) => {
        drawer.current = node
        if (node) update((value) => value + 1)
    }, [])
    const detailRef = useCallback((node: HTMLDivElement | null) => {
        reader.current = node
        if (node) update((value) => value + 1)
    }, [])
    const initialized = useRef(new WeakSet<HTMLElement>())
    const previous = useRef({ open: false, reading: false })
    const animations = useRef<Animation[]>([])
    const drag = useRef<{ id: number; x: number; origin: number; readerOrigin: number | null; at: number } | null>(null)

    useEffect(() => {
        // Native pointerdown precedes click (including touch). Keyboard-generated clicks
        // have no pointerdown. Escape always sets keyboard modality before Radix closes.
        const preference = matchMedia('(prefers-reduced-motion: reduce)')
        const syncPreference = () => setReduced(preference.matches)
        syncPreference()
        preference.addEventListener('change', syncPreference)
        const pointer = () => {
            modality.current = 'pointer'
        }
        const keyboard = () => {
            modality.current = 'keyboard'
        }
        const resize = () => update((value) => value + 1)
        document.addEventListener('pointerdown', pointer, true)
        document.addEventListener('keydown', keyboard, true)
        window.addEventListener('resize', resize)
        return () => {
            preference.removeEventListener('change', syncPreference)
            document.removeEventListener('pointerdown', pointer, true)
            document.removeEventListener('keydown', keyboard, true)
            window.removeEventListener('resize', resize)
        }
    }, [])

    const freeze = () => {
        // Sample before cancelling, so interruption never resets to a previous endpoint.
        for (const animation of animations.current) {
            const element = (animation.effect as KeyframeEffect).target as HTMLElement
            const style = getComputedStyle(element)
            element.style.transform = style.transform
            element.style.opacity = style.opacity
            animation.cancel()
        }
        animations.current = []
    }

    useLayoutEffect(() => {
        freeze()
        const sheet = drawer.current
        if (!sheet) return
        const detail = reader.current
        // Wait for the companion portal so its measured width and both motions
        // share the same start, without a preliminary index displacement.
        if (reading && !detail) return
        const mobile = matchMedia('(max-width: 800px)').matches
        const gutter = parseFloat(getComputedStyle(sheet).right)
        const width = sheet.getBoundingClientRect().width
        const shift = mobile ? -width / 4 : -((detail?.getBoundingClientRect().width ?? 0) + gutter)
        const quiet = reduced || modality.current === 'keyboard'
        const duration =
            (quiet ? motionTokens.duration.instant : !open || !reading ? profile.exit : profile.enter) * 1000
        // A first index entrance uses 260ms too; reader return and all exits use 240ms.
        const entering = open && (!previous.current.open || (reading && !previous.current.reading))
        previous.current = { open, reading }
        const timing = {
            duration: quiet ? duration : entering ? profile.enter * 1000 : duration,
            easing,
            fill: 'forwards' as const
        }
        const run = (element: HTMLElement, target: number, visible: boolean, initial: number) => {
            const fresh = !initialized.current.has(element)
            initialized.current.add(element)
            if (fresh) {
                element.style.transform = transform(quiet ? target : initial)
                element.style.opacity = quiet ? '0' : '1'
            }
            const from = getComputedStyle(element)
            const start = { transform: from.transform, opacity: from.opacity }
            const end = { transform: transform(target), opacity: visible ? '1' : '0' }
            if (quiet) {
                // Position changes instantly. Opacity is the only animated property.
                element.style.transform = end.transform
                const animation = element.animate([{ opacity: start.opacity }, { opacity: end.opacity }], timing)
                animations.current.push(animation)
            } else {
                // Keep functional panels opaque while travelling; fade only at the edge.
                const animation = element.animate(
                    [start, { opacity: visible ? '1' : start.opacity, offset: 0.85 }, end],
                    timing
                )
                animations.current.push(animation)
            }
            element.style.transform = end.transform
            element.style.opacity = end.opacity
        }
        const current = position(sheet)
        const delta = innerWidth - sheet.getBoundingClientRect().left + gutter
        // Closing both uses exactly the same delta from each current visual location.
        run(sheet, open ? (reading ? shift : 0) : quiet ? current : current + delta, open, width + gutter)
        if (detail) {
            const detailWidth = detail.getBoundingClientRect().width
            run(
                detail,
                reading
                    ? 0
                    : !open
                      ? quiet
                          ? position(detail)
                          : position(detail) + delta
                      : quiet
                        ? 0
                        : detailWidth + gutter,
                reading,
                detailWidth + gutter
            )
        }
        if (overlay.current) {
            const element = overlay.current
            const initial = initialized.current.has(element) ? getComputedStyle(element).opacity : '0'
            initialized.current.add(element)
            element.style.opacity = open ? '1' : '0'
            animations.current.push(element.animate([{ opacity: initial }, { opacity: element.style.opacity }], timing))
        }
        const active = [...animations.current]
        void Promise.all(active.map((animation) => animation.finished))
            .then(() => {
                if (active.some((animation) => !animations.current.includes(animation))) return
                setPresent({ drawer: open, reader: reading })
            })
            .catch(() => {
                /* A newer interaction owns completion. */
            })
        return freeze
    }, [open, reading, present.drawer, present.reader, reduced, revision])

    const handle = {
        onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
            if (
                reduced ||
                !open ||
                drag.current ||
                event.button !== 0 ||
                (event.target as Element).closest('button, a, input, select, textarea')
            )
                return
            freeze()
            drag.current = {
                id: event.pointerId,
                x: event.clientX,
                origin: position(drawer.current!),
                readerOrigin: reader.current ? position(reader.current) : null,
                at: performance.now()
            }
            event.currentTarget.setPointerCapture(event.pointerId)
        },
        onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
            const start = drag.current
            if (!start || start.id !== event.pointerId) return
            const distance = event.clientX - start.x
            const amount = distance >= 0 ? distance : -Math.sqrt(-distance)
            if (drawer.current) drawer.current.style.transform = transform(start.origin + amount)
            if (reader.current && start.readerOrigin !== null) {
                reader.current.style.transform = transform(start.readerOrigin + amount)
            }
        },
        onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
            const start = drag.current
            if (!start || start.id !== event.pointerId) return
            drag.current = null
            const distance = event.clientX - start.x
            if (distance > (drawer.current?.offsetWidth ?? 380) / 3 || distance / (performance.now() - start.at) > 0.5)
                close()
            else update((value) => value + 1)
        },
        onPointerCancel() {
            drag.current = null
            update((value) => value + 1)
        }
    }
    return {
        drawer: { present: present.drawer, ref: sheetRef, overlayRef: overlay, handle },
        reader: { present: present.reader, ref: detailRef }
    }
}
