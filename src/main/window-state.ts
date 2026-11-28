import type { BrowserWindow, Rectangle } from 'electron'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

export const minimumWindowSize = { width: 1000, height: 640 }
const stateSchema = z.object({
    x: z.int(),
    y: z.int(),
    width: z.int().positive(),
    height: z.int().positive(),
    maximized: z.boolean()
})
type WindowState = z.infer<typeof stateSchema>

function centered(area: Rectangle, width: number, height: number): Rectangle {
    width = Math.min(area.width, Math.max(minimumWindowSize.width, width))
    height = Math.min(area.height, Math.max(minimumWindowSize.height, height))
    return {
        x: area.x + Math.floor((area.width - width) / 2),
        y: area.y + Math.floor((area.height - height) / 2),
        width,
        height
    }
}

export function loadWindowState(file: string, primary: Rectangle, areas: Rectangle[]): WindowState {
    let saved: WindowState
    try {
        saved = stateSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
        return { ...centered(primary, 1560, 1000), maximized: true }
    }
    let display = primary
    let largest = 0
    for (const area of areas) {
        const width = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)
        const height = Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y)
        const intersection = Math.max(0, width) * Math.max(0, height)
        if (intersection > largest) {
            display = area
            largest = intersection
        }
    }
    const fitted = centered(display, saved.width, saved.height)
    if (largest === saved.width * saved.height && fitted.width === saved.width && fitted.height === saved.height)
        return saved
    return { ...fitted, maximized: saved.maximized }
}

export function restoreWindowsBounds(window: BrowserWindow, { x, y, width, height }: Rectangle) {
    // On Windows the frameless constructor adds frame insets. Apply the outer
    // bounds while hidden and compensate for DIP rounding at fractional scale.
    window.setBounds({ x, y, width, height })
    const actual = window.getBounds()
    if (actual.width !== width || actual.height !== height || actual.x !== x || actual.y !== y)
        window.setBounds({
            x: x + (x - actual.x),
            y: y + (y - actual.y),
            width: width + (width - actual.width),
            height: height + (height - actual.height)
        })
}

export function captureWindowState(window: Pick<BrowserWindow, 'isMaximized' | 'getNormalBounds' | 'getBounds'>) {
    const maximized = window.isMaximized()
    const bounds = maximized ? window.getNormalBounds() : window.getBounds()
    return { ...bounds, maximized }
}

export function saveWindowState(file: string, state: WindowState) {
    const pending = `${file}.${process.pid}.tmp`
    try {
        writeFileSync(pending, JSON.stringify(state))
        renameSync(pending, file)
    } catch {
        // Geometry is a preference. A read-only profile must still be able to close.
        try {
            rmSync(pending, { force: true })
        } catch {
            // The profile itself may be inaccessible.
        }
    }
}

export function trackWindowState(file: string, window: BrowserWindow) {
    let timer: ReturnType<typeof setTimeout>
    let last = captureWindowState(window)
    const flush = () => {
        clearTimeout(timer)
        if (!window.isMinimized()) last = captureWindowState(window)
        saveWindowState(file, last)
    }
    const schedule = () => {
        if (!window.isMinimized()) last = captureWindowState(window)
        clearTimeout(timer)
        timer = setTimeout(flush, 200)
    }
    window.on('move', schedule)
    window.on('resize', schedule)
    window.on('maximize', schedule)
    window.on('unmaximize', schedule)
    window.on('close', flush)
    window.once('closed', () => clearTimeout(timer))
}
