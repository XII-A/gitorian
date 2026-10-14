'use client'

import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentPropsWithoutRef, ForwardRefRenderFunction } from 'react'
import { forwardRef } from 'react'

import styles from './popover.module.css'

export const Popover = PopoverPrimitive.Root
export const PopoverClose = PopoverPrimitive.Close
export const PopoverAnchor = PopoverPrimitive.Anchor

/** The trigger anchors the panel, so it opts out of press-scale: a scaled rect measured on open would shift the panel as the trigger springs back. */
const PopoverTriggerRender: ForwardRefRenderFunction<
    HTMLButtonElement,
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
> = ({ className, ...props }, ref) => (
    <PopoverPrimitive.Trigger {...props} ref={ref} className={[styles.anchor, className].filter(Boolean).join(' ')} />
)
export const PopoverTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>>(
    PopoverTriggerRender
)

PopoverTrigger.displayName = 'PopoverTrigger'

const PopoverContentRender: ForwardRefRenderFunction<
    HTMLDivElement,
    ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
> = ({ className, align = 'start', sideOffset = 6, collisionPadding = 10, ...props }, ref) => (
    <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
            {...props}
            ref={ref}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={[styles.content, className].filter(Boolean).join(' ')}
        />
    </PopoverPrimitive.Portal>
)
export const PopoverContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(
    PopoverContentRender
)

PopoverContent.displayName = 'PopoverContent'
