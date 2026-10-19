import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/** Keep native top-edge hover detection clear of in-app navigation. */
export function useWindowHoverExclusion(target: RefObject<HTMLElement | null>) {
    useLayoutEffect(() => {
        const controls = window.journal?.windowControls
        const element = target.current
        if (!controls || !element) return
        const update = () => {
            const { x, y, width, height } = element.getBoundingClientRect()
            controls.setHoverExclusion({ x, y, width, height })
        }
        const observer = new ResizeObserver(update)
        observer.observe(element)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        update()
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
            controls.setHoverExclusion(null)
        }
    }, [target])
}
