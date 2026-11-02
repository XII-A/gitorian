import { app, clipboard } from 'electron'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const profile = process.env.GITORIAN_E2E_PROFILE
if (!profile) throw new Error('Disposable profile required')
if (process.env.GITORIAN_RECOVERY_START === '1') {
    writeFileSync(join(profile, 'restarted-pid.json'), JSON.stringify({ pid: process.pid }))
    app.once('browser-window-created', (_event, window) => {
        window.webContents.once('did-finish-load', async () => {
            try {
                const proof = await window.webContents.executeJavaScript(
                    `(async()=>({diagnostics:await window.journal.diagnostics.state(),titles:(await window.journal.invoke({type:'state'})).state.drafts.map(d=>d.title),recoveryCopies:Object.keys(localStorage).filter(k=>k.startsWith('gitorian:recovery:')).map(k=>JSON.parse(localStorage.getItem(k)).title)}))()`
                )
                writeFileSync(join(profile, 'restarted-proof.json'), JSON.stringify(proof))
                app.once('quit', () => writeFileSync(join(profile, 'restarted-exit.json'), '{}'))
                app.quit()
            } catch (error) {
                writeFileSync(join(profile, 'restarted-error.txt'), String(error))
                app.quit()
            }
        })
    })
}
const directory = join(profile, 'diagnostics')
mkdirSync(directory, { recursive: true })
if (!existsSync(join(directory, 'current.json')))
    writeFileSync(
        join(directory, 'current.json'),
        JSON.stringify({
            reportVersion: 1,
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            time: new Date().toISOString(),
            app: { version: 'fixture', platform: 'win32', build: 'fixture' },
            clean: false,
            dropped: 0,
            events: []
        })
    )
process.env.GITORIAN_E2E_RECOVERY_ENTRY = resolve('tests/e2e/support/recovery-dialog-main.mjs')
app.on('gitorian-fail-copy', () => {
    const write = clipboard.writeText
    clipboard.writeText = async () => {
        clipboard.writeText = write
        throw new Error('Fixture: clipboard temporarily unavailable')
    }
})
app.on('gitorian-block-main', () =>
    setTimeout(() => {
        // Finite only to guarantee fixture cleanup; no timer/IPC callback can run during this interval.
        const end = performance.now() + 40000
        while (performance.now() < end) {
            /* Controlled main-thread starvation. */
        }
    }, 100)
)
await import(pathToFileURL(resolve('out/main/index.js')).href)
