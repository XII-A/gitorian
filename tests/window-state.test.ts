import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { captureWindowState, loadWindowState, saveWindowState } from '../src/main/window-state'

const primary = { x: 100, y: 24, width: 1920, height: 1080 }
const secondary = { x: -1500, y: 0, width: 1600, height: 900 }
let directory: string
let file: string
beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'gitorian-window-test-'))
    file = join(directory, 'window-state.json')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it.each([undefined, '{', '{"maximized":true}', '{"x":1,"y":1,"width":-10,"height":10,"maximized":false}'])(
    'centers fresh restore bounds when the state file contains %s',
    (contents) => {
        if (contents !== undefined) writeFileSync(file, contents)
        expect(loadWindowState(file, primary, [primary])).toEqual({
            x: 280,
            y: 64,
            width: 1560,
            height: 1000,
            maximized: true
        })
    }
)

it('fits the initial restore bounds to a small work area', () => {
    const small = { x: 40, y: 20, width: 900, height: 600 }
    expect(loadWindowState(file, small, [small])).toEqual({ ...small, maximized: true })
})

it.each([true, false])('round-trips the normal bounds on a secondary display with maximized=%s', (maximized) => {
    const normal = { x: -1450, y: 70, width: 1030, height: 690 }
    saveWindowState(
        file,
        captureWindowState({
            isMaximized: () => maximized,
            getBounds: () => (maximized ? secondary : normal),
            getNormalBounds: () => normal
        })
    )
    expect(loadWindowState(file, primary, [primary, secondary])).toEqual({ ...normal, maximized })
    expect(loadWindowState(file, primary, [primary])).toEqual({
        x: 545,
        y: 219,
        width: 1030,
        height: 690,
        maximized
    })
})

it('fits an overflowing window to the display with the largest intersection', () => {
    writeFileSync(file, JSON.stringify({ x: -1610, y: -50, width: 1750, height: 1100, maximized: false }))
    expect(loadWindowState(file, primary, [primary, secondary])).toEqual({ ...secondary, maximized: false })
})
