import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { release } from 'node:os'
import { app, clipboard, dialog, powerMonitor } from 'electron'
import { IncidentReports, failureObservation } from './incident-reports'
import { RecoveryAdmission } from './recovery-admission'
import type { DiagnosticObservation, DiagnosticState } from '../shared/diagnostics'
import type { DiagnosticObserver } from './diagnostic-observer'

export class DesktopDiagnostics implements DiagnosticObserver {
    readonly recovery: RecoveryAdmission
    private readonly timer: ReturnType<typeof setInterval>
    private available: boolean
    private observationPending = false
    private dropped = 0
    private shutdown = () => app.quit()
    private readonly files = new Set(
        readdirSync(fileURLToPath(new URL('.', import.meta.url))).filter((file) => file.endsWith('.js'))
    )
    private constructor(
        private readonly directory: string,
        private readonly worker: ChildProcess | undefined,
        private readonly local: IncidentReports | undefined,
        state: { recovery: boolean; available: boolean }
    ) {
        this.available = state.available
        this.recovery = new RecoveryAdmission(state.recovery || process.env.GITORIAN_RECOVERY_START === '1')
        delete process.env.GITORIAN_RECOVERY_START
        this.timer = setInterval(() => this.send({ type: 'pulse' }), 1000)
        this.timer.unref()
        powerMonitor.on('resume', () => this.send({ type: 'resume' }))
        worker?.on('exit', () => {
            this.available = false
        })
        worker?.on('message', (message: unknown) => {
            if (message && typeof message === 'object' && 'type' in message && message.type === 'shutdown')
                this.shutdown()
        })
    }
    static async start(profile: string, directory: string) {
        const destination = join(profile, 'diagnostics')
        const identity = {
            version: app.getVersion(),
            platform: process.platform,
            electron: process.versions.electron,
            node: process.versions.node,
            architecture: process.arch,
            os: release(),
            build: createHash('sha256')
                .update(readFileSync(fileURLToPath(import.meta.url)))
                .digest('hex')
                .slice(0, 16)
        }
        if (process.platform === 'win32') {
            const worker = spawn(process.execPath, [join(directory, 'recovery-watchdog.js')], {
                detached: true,
                windowsHide: true,
                stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: '1',
                    GITORIAN_WATCHDOG: JSON.stringify({
                        directory: destination,
                        executable: process.execPath,
                        appPath: app.isPackaged ? app.getAppPath() : process.argv[1],
                        packaged: app.isPackaged,
                        testEntry: !app.isPackaged ? process.env.GITORIAN_E2E_RECOVERY_ENTRY : undefined,
                        profile,
                        parent: process.pid,
                        identity,
                        recoveryRequested: process.env.GITORIAN_RECOVERY_START === '1'
                    })
                }
            })
            const state = await new Promise<{ recovery: boolean; available: boolean } | undefined>((resolve) => {
                const timeout = setTimeout(() => resolve(undefined), 5000)
                worker.once('error', () => {
                    clearTimeout(timeout)
                    resolve(undefined)
                })
                worker.once('exit', () => {
                    clearTimeout(timeout)
                    resolve(undefined)
                })
                worker.once('message', (message: unknown) => {
                    if (
                        message &&
                        typeof message === 'object' &&
                        'type' in message &&
                        message.type === 'ready' &&
                        'recovery' in message &&
                        typeof message.recovery === 'boolean' &&
                        'available' in message &&
                        typeof message.available === 'boolean'
                    ) {
                        clearTimeout(timeout)
                        resolve({ recovery: message.recovery, available: message.available })
                    }
                })
            })
            if (state) return new DesktopDiagnostics(destination, worker, undefined, state)
            if (worker.exitCode === null && worker.pid) {
                worker.kill()
                await new Promise<void>((resolve) => worker.once('exit', () => resolve()))
            }
        }
        const local = new IncidentReports(destination, identity, process.env.GITORIAN_RECOVERY_START === '1')
        return new DesktopDiagnostics(destination, undefined, local, {
            recovery: local.recoveryPending,
            available: local.available
        })
    }
    state(): DiagnosticState {
        return { recovery: !this.recovery.normal, available: this.available, liveRecovery: !!this.worker?.connected }
    }
    prepareShutdown(handler: () => void) {
        this.shutdown = handler
    }
    private send(message: object) {
        if (this.worker?.connected) this.worker.send(message, () => undefined)
    }
    observe(event: DiagnosticObservation) {
        if (this.local) this.local.observe(event)
        else if (this.worker?.connected) {
            if (this.observationPending) {
                this.dropped++
                return
            }
            this.observationPending = true
            this.worker.send({ type: 'observe', event, dropped: this.dropped }, () => {
                this.observationPending = false
            })
            this.dropped = 0
        }
    }
    failure(operation: string, error?: unknown) {
        if (this.local) this.local.failure(operation, error)
        else {
            this.observe(failureObservation(operation, error, this.files))
            this.send({ type: 'incident', kind: operation })
        }
    }
    async report() {
        if (this.local) return this.local.report()
        if (this.worker?.connected) {
            const id = Math.random().toString(36)
            const text = await new Promise<string | undefined>((resolve) => {
                const receive = (message: unknown) => {
                    if (
                        message &&
                        typeof message === 'object' &&
                        'id' in message &&
                        message.id === id &&
                        'text' in message &&
                        typeof message.text === 'string'
                    ) {
                        clearTimeout(timeout)
                        this.worker!.removeListener('message', receive)
                        resolve(message.text.slice(0, 131072))
                    }
                }
                const timeout = setTimeout(() => {
                    this.worker!.removeListener('message', receive)
                    resolve(undefined)
                }, 2000)
                this.worker!.on('message', receive)
                this.send({ type: 'report', id })
            })
            if (text) return text
        }
        try {
            return (await readFile(join(this.directory, 'report.txt'), 'utf8')).slice(0, 131072)
        } catch {
            this.available = false
            return 'Gitorian diagnostic storage unavailable. No journal content was collected.'
        }
    }
    async copy() {
        await clipboard.writeText(await this.report())
        return true
    }
    continueNormally() {
        this.recovery.continueNormally()
        this.local?.resume()
        this.send({ type: 'continue' })
    }
    pause() {
        this.recovery.pause()
        this.local?.pause()
        this.send({ type: 'pause' })
    }
    async save() {
        const result = await dialog.showSaveDialog({ defaultPath: 'gitorian-diagnostic-report.txt' })
        if (!result.filePath) return false
        await writeFile(result.filePath, await this.report())
        return true
    }
    async finish() {
        clearInterval(this.timer)
        if (this.local) this.local.finish()
        else if (this.worker?.connected)
            await new Promise<void>((resolve) => {
                const worker = this.worker!
                const complete = () => {
                    clearTimeout(timeout)
                    worker.removeListener('message', receive)
                    worker.removeListener('exit', complete)
                    resolve()
                }
                const receive = (message: unknown) => {
                    if (
                        message &&
                        typeof message === 'object' &&
                        'type' in message &&
                        message.type === 'restart-finishing'
                    )
                        complete()
                }
                const timeout = setTimeout(() => {
                    worker.kill()
                    complete()
                }, 3000)
                worker.once('exit', complete)
                worker.on('message', receive)
                worker.send({ type: 'finish' }, () => undefined)
            })
    }
}
