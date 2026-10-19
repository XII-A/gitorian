import { screen } from 'electron'
import type { BrowserWindow } from 'electron'

export function watchWindowTitleBar(window: BrowserWindow) {
    let revealed = false
    let leftAt: number | undefined
    const reveal = (value: boolean) => {
        if (revealed === value) return
        revealed = value
        if (!window.webContents.isDestroyed()) window.webContents.send('journal:window-hover', value)
    }
    // Native drag regions consume pointer events. Screen coordinates keep the
    // entire title bar usable, including while the pointer crosses its drag area.
    const timer = setInterval(() => {
        if (!window.isVisible() || window.isMinimized()) {
            leftAt = undefined
            reveal(false)
            return
        }
        const cursor = screen.getCursorScreenPoint()
        const bounds = window.getContentBounds()
        const x = cursor.x - bounds.x
        const y = cursor.y - bounds.y
        const inside = x >= 0 && x < bounds.width && y >= 0 && y < (revealed ? 52 : 12)
        if (inside) {
            leftAt = undefined
            reveal(true)
        } else if (revealed) {
            leftAt ??= Date.now()
            if (Date.now() - leftAt >= 350) reveal(false)
        }
    }, 50)
    timer.unref()
    window.on('closed', () => clearInterval(timer))
}
