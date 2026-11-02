import { dialog, clipboard } from 'electron'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const profile = process.env.GITORIAN_RECOVERY_PROFILE
const copy = clipboard.writeText.bind(clipboard)
clipboard.writeText = (text) => {
    writeFileSync(join(profile, 'recovery-copy-write.txt'), text)
    return copy(text)
}
let shown = 0
// Automate only the native dialog response. Watchdog, process launch, report and clipboard remain real.
dialog.showMessageBox = async (options) => {
    if (process.env.GITORIAN_E2E_FORCE_RESTART === '1')
        return { response: options.message === 'Restart Gitorian?' ? 1 : 3 }
    if (++shown === 1) {
        writeFileSync(
            join(profile, 'recovery-dialog.json'),
            JSON.stringify({ pid: process.pid, message: options.message, buttons: options.buttons })
        )
        return { response: 1 }
    }
    writeFileSync(join(profile, 'recovery-copy.txt'), await clipboard.readText())
    return { response: 0 }
}
await import(pathToFileURL(resolve('out/main/index.js')).href)
