import { ipcMain, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import type { IpcMainEvent } from 'electron'
import { z } from 'zod'

const exclusionSchema = z
    .object({
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative()
    })
    .nullable()

export function watchWindowTitleBar(window: BrowserWindow) {
    let revealed = false
    let leftAt: number | undefined
    let exclusion: z.infer<typeof exclusionSchema> = null
    const receiveExclusion = (event: IpcMainEvent, value: unknown) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return
        const parsed = exclusionSchema.safeParse(value)
        if (parsed.success) exclusion = parsed.data
    }
    ipcMain.on('journal:window-hover-exclusion', receiveExclusion)
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) exclusion = null
    })
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
        // Include the top-edge approach to the breadcrumb, plus a small margin.
        // Dismiss immediately here: the normal leave grace period would cover
        // the navigation target just as the user tries to click it.
        if (
            exclusion &&
            x >= exclusion.x - 8 &&
            x < exclusion.x + exclusion.width + 8 &&
            y >= 0 &&
            y < exclusion.y + exclusion.height + 8
        ) {
            leftAt = undefined
            reveal(false)
            return
        }
        // Cursor/bounds use DIPs; hover heights are CSS pixels, including their margin.
        const hoverHeight = (revealed ? 40 : 6) * window.webContents.getZoomFactor()
        const inside = x >= 0 && x < bounds.width && y >= 0 && y < hoverHeight
        if (inside) {
            leftAt = undefined
            reveal(true)
        } else if (revealed) {
            leftAt ??= Date.now()
            if (Date.now() - leftAt >= 350) reveal(false)
        }
    }, 50)
    timer.unref()
    window.on('closed', () => {
        clearInterval(timer)
        ipcMain.removeListener('journal:window-hover-exclusion', receiveExclusion)
    })
}
