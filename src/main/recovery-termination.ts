import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Windows adapter: pin ownership, attempt cooperative shutdown, and confirm exact native exit. */
export function terminateDesktop(parent: number, authorize: () => boolean, shutdown: () => void) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                fileURLToPath(new URL('./recovery-terminate.ps1', import.meta.url)).replace(
                    /([\\/])app\.asar([\\/])/,
                    '$1app.asar.unpacked$2'
                ),
                '-TargetProcess',
                String(parent),
                '-WatchProcess',
                String(process.pid)
            ],
            {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        )
        const timeout = setTimeout(() => {
            child.kill()
            reject(new Error('Restart ownership could not be verified'))
        }, 20000)
        let output = ''
        child.stdout.on('data', (bytes: Buffer) => {
            output += bytes.toString()
            if (output.includes('ready') && !child.stdin.destroyed) {
                output = output.replace('ready', '')
                const authorized = authorize()
                child.stdin.end(authorized ? 'go\n' : 'cancel\n')
                if (authorized) shutdown()
            }
        })
        child.once('error', (error) => {
            clearTimeout(timeout)
            reject(error)
        })
        child.once('close', (code) => {
            clearTimeout(timeout)
            if (code === 0 && output.includes('exited')) resolve()
            else reject(new Error('Restart ownership could not be verified'))
        })
    })
}
