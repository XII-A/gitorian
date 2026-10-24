import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { OnboardingActivityPreview } from './OnboardingActivityPreview'

/** Keep preview text rasterized at a stable origin while disclosures change the checklist's height. */
export function OnboardingSetupLayout({ children }: { children: ReactNode }) {
    const root = useRef<HTMLDivElement>(null)
    const checklist = useRef<HTMLDivElement>(null)
    const preview = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const container = root.current,
            card = checklist.current,
            illustration = preview.current
        if (!container || !card || !illustration) return
        const place = (height: number) => {
            illustration.style.transform = `translateY(${height}px)`
        }
        const reserve = (height: number) => {
            container.style.paddingBlockEnd = `${height}px`
        }
        place(card.getBoundingClientRect().height)
        reserve(illustration.getBoundingClientRect().height)
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height
                if (entry.target === card) place(height)
                else reserve(height)
            }
        })
        observer.observe(card)
        observer.observe(illustration)
        return () => observer.disconnect()
    }, [])
    return (
        <div ref={root} className="hub-setup-layout">
            <div ref={checklist}>{children}</div>
            <div ref={preview} className="hub-preview-positioner">
                <OnboardingActivityPreview />
            </div>
        </div>
    )
}
