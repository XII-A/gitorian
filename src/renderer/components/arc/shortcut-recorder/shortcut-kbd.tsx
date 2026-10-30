import { forwardRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import styles from './shortcut-kbd.module.css'

// Standalone keycap from Arc's shortcut recorder: https://uiarc.dev/r/shortcut-recorder.json
export interface ShortcutKbdProps extends HTMLAttributes<HTMLElement> {
    children: ReactNode
    /** Draws the key pushed down and lit, such as while it is held. */
    pressed?: boolean
    size?: 'sm' | 'md'
}

/** A key cap. Use it inline in copy, in menus, or through `ShortcutKeys` for a whole combination. */
export const ShortcutKbd = forwardRef<HTMLElement, ShortcutKbdProps>(function ShortcutKbd(
    { children, pressed = false, size = 'md', className, ...props },
    ref
) {
    return (
        <kbd
            ref={ref}
            {...props}
            className={[styles.kbd, className].filter(Boolean).join(' ')}
            data-size={size}
            data-pressed={pressed || undefined}
        >
            {children}
        </kbd>
    )
})
ShortcutKbd.displayName = 'ShortcutKbd'
