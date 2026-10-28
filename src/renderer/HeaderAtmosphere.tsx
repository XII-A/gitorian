import { useEffect, useRef, useState } from 'react'
import type { createHeaderSky } from './header-sky'
import { headerSkyPalette } from './header-sky-palette'
import type { SkyPhase } from './header-sky-palette'
import { DropdownMenu } from './components/arc/dropdown-menu/dropdown-menu'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'
import './header-atmosphere.css'

// Session-only preview survives hub/workspace navigation and never changes journal settings.
let previewTheme: SkyPhase | 'auto' = 'auto'
const previewChoices = [
    { value: 'auto', label: 'Automatic' },
    { value: 'dawn', label: 'Dawn' },
    { value: 'day', label: 'Day' },
    { value: 'dusk', label: 'Dusk' },
    { value: 'night', label: 'Night' }
] as const

/** Owns decorative rendering; neither journal state nor editor renders drive the sky. */
export function HeaderAtmosphere({ surface }: { surface: 'hub' | 'workspace' }) {
    const root = useRef<HTMLDivElement>(null)
    const [preview, setPreview] = useState(previewTheme)
    const applyPreview = useRef<(() => void) | undefined>(undefined)
    const [motion, setMotion] = useState('Starting sky')
    useEffect(() => {
        const element = root.current!
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
        const status = new MutationObserver(() => {
            setMotion(
                surface === 'hub' && reduce.matches
                    ? 'Reduced motion'
                    : element.dataset.renderer === 'animated'
                      ? 'Animation on'
                      : 'Static sky'
            )
        })
        status.observe(element, { attributes: true, attributeFilter: ['data-renderer'] })
        let disposed = false
        let visible = false
        let failed = false
        let generation = 0
        let engine: ReturnType<typeof createHeaderSky> = null
        let canvas: HTMLCanvasElement | undefined
        let timer = 0
        let appearance = headerSkyPalette(new Date(), previewTheme)
        const stop = () => {
            generation++
            engine?.destroy()
            engine = null
            canvas?.remove()
            canvas = undefined
            element.dataset.renderer = 'static'
        }
        const sync = async () => {
            stop()
            if (disposed || failed || reduce.matches || !visible || document.hidden) return
            const version = generation
            try {
                const { createHeaderSky } = await import('./header-sky')
                if (disposed || version !== generation) return
                canvas = document.createElement('canvas')
                canvas.addEventListener(
                    'webglcontextlost',
                    (event) => {
                        if (event.target !== canvas) return
                        // Keep the static sky for this visit; remounting is the recovery seam.
                        failed = true
                        stop()
                    },
                    { once: true }
                )
                element.append(canvas)
                engine = createHeaderSky(canvas, appearance.colors, surface === 'hub')
                if (!engine) {
                    failed = true
                    stop()
                }
            } catch {
                failed = true
                stop()
            }
        }
        const updateTime = () => {
            window.clearTimeout(timer)
            appearance = headerSkyPalette(new Date(), previewTheme)
            element.dataset.phase = appearance.phase
            appearance.colors.forEach((color, i) => element.style.setProperty(`--sky-${i}`, color))
            engine?.setPalette(appearance.colors)
            if (!document.hidden) timer = window.setTimeout(updateTime, 60_000 - (Date.now() % 60_000))
        }
        const resume = () => {
            updateTime()
            void sync()
        }
        const focus = () => updateTime()
        applyPreview.current = updateTime
        const observer = new IntersectionObserver(([entry]) => {
            const next = entry?.isIntersecting ?? false
            if (next !== visible) {
                visible = next
                void sync()
            }
        })
        observer.observe(element)
        updateTime()
        reduce.addEventListener('change', resume)
        document.addEventListener('visibilitychange', resume)
        window.addEventListener('focus', focus)
        return () => {
            disposed = true
            observer.disconnect()
            status.disconnect()
            reduce.removeEventListener('change', resume)
            document.removeEventListener('visibilitychange', resume)
            window.removeEventListener('focus', focus)
            window.clearTimeout(timer)
            stop()
        }
    }, [surface])
    return (
        <>
            <div
                ref={root}
                className={`header-atmosphere ${surface}-header-sky`}
                aria-hidden="true"
                data-renderer="static"
            />
            <div className="header-sky-preview">
                <FloatingButtonGroup
                    label="Sky preview"
                    variant="floating"
                    size="sm"
                    items={[]}
                    startContent={
                        <>
                            <DropdownMenu
                                label={`Sky: ${previewChoices.find((choice) => choice.value === preview)!.label}`}
                                items={previewChoices.map((choice) => ({
                                    label: choice.label,
                                    onSelect: () => {
                                        previewTheme = choice.value
                                        setPreview(choice.value)
                                        applyPreview.current?.()
                                    }
                                }))}
                            />
                            <span className="header-sky-motion" role="status">
                                {motion}
                            </span>
                        </>
                    }
                />
            </div>
        </>
    )
}
