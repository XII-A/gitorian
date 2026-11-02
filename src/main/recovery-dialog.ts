import { app, clipboard, dialog } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** This role can never initialize SQLite or a journal writer. */
export async function showRecoveryDialog(profile: string) {
    const host = process.env.GITORIAN_RECOVERY_HOST ?? app.getPath('temp')
    try {
        await mkdir(host, { recursive: true })
        app.setPath('userData', host)
        app.setPath('sessionData', host)
    } catch {
        app.setPath('userData', app.getPath('temp'))
        app.setPath('sessionData', app.getPath('temp'))
    }
    let active: AbortController | undefined
    process.on('message', (message: unknown) => {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'responsive') {
            active?.abort()
            app.exit()
        }
    })
    await app.whenReady()
    const report = async () => {
        if (process.connected) {
            const value = await new Promise<string | undefined>((resolve) => {
                const receive = (message: unknown) => {
                    if (
                        message &&
                        typeof message === 'object' &&
                        'type' in message &&
                        message.type === 'report' &&
                        'text' in message &&
                        typeof message.text === 'string'
                    ) {
                        clearTimeout(timeout)
                        process.removeListener('message', receive)
                        resolve(message.text.slice(0, 131072))
                    }
                }
                const timeout = setTimeout(() => {
                    process.removeListener('message', receive)
                    resolve(undefined)
                }, 2000)
                process.on('message', receive)
                process.send?.('get-report')
            })
            if (value) return value
        }
        try {
            return (await readFile(join(profile, 'diagnostics', 'report.txt'), 'utf8')).slice(0, 131072)
        } catch {
            return 'Gitorian diagnostic report unavailable. The journal was not modified.'
        }
    }
    for (;;) {
        active = new AbortController()
        const result = await dialog.showMessageBox({
            type: 'warning',
            title: 'Gitorian recovery',
            message: 'Gitorian needs your attention',
            detail: 'The app stopped responding or closed unexpectedly. You can wait or share a diagnostic report. Restarting may lose unsaved changes.',
            buttons: ['Wait', 'Copy diagnostic report', 'Save report', 'Restart in recovery'],
            defaultId: 0,
            cancelId: 0,
            signal: active.signal
        })
        if (result.response === 0) break
        if (result.response === 1) {
            try {
                await clipboard.writeText(await report())
            } catch {
                dialog.showErrorBox('Could not copy report', 'Try saving the report to a file instead.')
            }
        }
        if (result.response === 2) {
            const destination = await dialog.showSaveDialog({ defaultPath: 'gitorian-diagnostic-report.txt' })
            if (destination.filePath) {
                try {
                    await writeFile(destination.filePath, await report())
                } catch {
                    dialog.showErrorBox('Could not save report', 'Choose another folder and try again.')
                }
            }
        }
        if (result.response === 3) {
            const confirm = await dialog.showMessageBox({
                type: 'warning',
                message: 'Restart Gitorian?',
                detail: 'Unsaved changes may be lost. Automatic refresh will stay paused on reopening.',
                buttons: ['Cancel', 'Restart in recovery'],
                defaultId: 0,
                cancelId: 0
            })
            if (confirm.response === 1 && process.connected) {
                await new Promise<void>((resolve) => process.send?.('restart', () => resolve()))
                break
            }
            if (!process.connected) dialog.showErrorBox('Gitorian has closed', 'Open Gitorian again to enter recovery.')
        }
    }
    app.exit()
}
