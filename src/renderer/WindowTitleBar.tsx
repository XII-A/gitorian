import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import './window-title-bar.css'
import type { DesktopBridge } from '../shared/model'

export function WindowTitleBar() {
    const [controls, setControls] = useState<DesktopBridge['windowControls']>()
    const [maximized, setMaximized] = useState(false)
    const [hovered, setHovered] = useState(false)
    const [keyboardFocus, setKeyboardFocus] = useState(false)
    useEffect(() => {
        const desktop = window.journal?.windowControls
        setControls(desktop)
        if (!desktop) return
        let active = true
        const unsubscribe = desktop.onState((state) => setMaximized(state.maximized))
        const unsubscribeHover = desktop.onHover(setHovered)
        const blur = () => setKeyboardFocus(false)
        window.addEventListener('blur', blur)
        void desktop.action('state').then((state) => {
            if (active && state) setMaximized(state.maximized)
        })
        return () => {
            active = false
            unsubscribe()
            unsubscribeHover()
            window.removeEventListener('blur', blur)
        }
    }, [])
    if (!controls) return null
    return (
        <div
            className="window-chrome"
            data-revealed={hovered || keyboardFocus}
            onPointerDownCapture={() => setKeyboardFocus(false)}
            onFocusCapture={(event) => setKeyboardFocus(event.target.matches(':focus-visible'))}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false)
            }}
        >
            <div className="window-title-bar" role="toolbar" aria-label="Window controls">
                <div className="window-title-bar-drag">weekly-j</div>
                <button
                    type="button"
                    aria-label="Minimize window"
                    title="Minimize"
                    onClick={() => void controls.action('minimize')}
                >
                    <Minus size={16} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    aria-label={maximized ? 'Restore window' : 'Maximize window'}
                    title={maximized ? 'Restore' : 'Maximize'}
                    onClick={() => void controls.action('toggleMaximize')}
                >
                    {maximized ? <Copy size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
                </button>
                <button
                    type="button"
                    className="window-title-bar-close"
                    aria-label="Close window"
                    title="Close"
                    onClick={() => void controls.action('close')}
                >
                    <X size={18} aria-hidden="true" />
                </button>
            </div>
        </div>
    )
}
