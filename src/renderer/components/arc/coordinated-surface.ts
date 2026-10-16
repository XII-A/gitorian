import type { HTMLAttributes, Ref, RefObject } from 'react'

/** Opt-in portal lifetime and native animation ownership for composed surfaces. */
export interface CoordinatedSurface {
    present: boolean
    ref: Ref<HTMLDivElement>
    overlayRef?: RefObject<HTMLDivElement | null>
    handle?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>
}
