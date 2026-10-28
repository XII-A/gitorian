import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { _electron as electron } from '@playwright/test'
import { gemoji } from 'gemoji'
import sharp from 'sharp'

// Capture system color glyphs once, rather than shaping/painting fonts during picker scrolling.
if (process.platform !== 'win32') throw new Error('Generate the bundled Segoe UI Emoji atlas on Windows.')
const scratch = mkdtempSync(join(tmpdir(), 'gitorian-emoji-atlas-'))
if (dirname(scratch) !== resolve(tmpdir()) || !basename(scratch).startsWith('gitorian-emoji-atlas-')) {
    throw new Error('Unexpected generator scratch path')
}
let app
try {
    const main = join(scratch, 'main.cjs')
    writeFileSync(
        main,
        `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(scratch, 'profile'))});
app.whenReady().then(() => { const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } }); win.loadURL('data:text/html,<html><body></body></html>'); });`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: [main], env, timeout: 15_000 })
    const page = await app.firstWindow()
    const columns = 32,
        cell = 64,
        rows = Math.ceil(gemoji.length / columns)
    const png = await page.evaluate(
        ({ emojis, columns, cell, rows }) => {
            const canvas = document.createElement('canvas')
            canvas.width = columns * cell
            canvas.height = rows * cell
            const ctx = canvas.getContext('2d')
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            for (let i = 0; i < emojis.length; i++) {
                ctx.font = '52px "Segoe UI Emoji"'
                const width = ctx.measureText(emojis[i]).width
                if (width > cell - 4) ctx.font = `${Math.floor((52 * (cell - 4)) / width)}px "Segoe UI Emoji"`
                ctx.fillText(emojis[i], ((i % columns) + 0.5) * cell, (Math.floor(i / columns) + 0.5) * cell + 2)
            }
            return canvas.toDataURL('image/png').split(',')[1]
        },
        { emojis: gemoji.map((item) => item.emoji), columns, cell, rows }
    )
    const destination = resolve('src/renderer/assets')
    mkdirSync(destination, { recursive: true })
    const webp = await sharp(Buffer.from(png, 'base64')).webp({ lossless: true, effort: 6 }).toBuffer()
    writeFileSync(join(destination, 'emoji-atlas.webp'), webp)
    writeFileSync(
        join(destination, 'emoji-atlas.json'),
        JSON.stringify(
            { columns, rows, indices: Object.fromEntries(gemoji.map((item, index) => [item.emoji, index])) },
            null,
            4
        ) + '\n'
    )
    console.info(`Generated ${gemoji.length} glyphs, ${columns * cell} x ${rows * cell}, ${webp.length} bytes`)
} finally {
    await app?.close()
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
