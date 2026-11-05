import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { mkdtempSync, rmSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname, resolve } from 'node:path'
import { z } from 'zod'
import { IncidentReports } from './incident-reports'
import { terminateDesktop } from './recovery-termination'

const config = z
    .object({
        directory: z.string(),
        executable: z.string(),
        appPath: z.string(),
        packaged: z.boolean(),
        testEntry: z.string().optional(),
        profile: z.string(),
        parent: z.number().int().positive(),
        recoveryRequested: z.boolean().optional(),
        identity: z.object({
            version: z.string(),
            platform: z.string(),
            build: z.string(),
            electron: z.string().optional(),
            node: z.string().optional(),
            architecture: z.string().optional(),
            os: z.string().optional()
        })
    })
    .parse(JSON.parse(process.env.GITORIAN_WATCHDOG ?? '{}'))
delete process.env.GITORIAN_WATCHDOG
if (config.parent !== process.ppid || !process.connected) process.exit(1)
const reports = new IncidentReports(config.directory, config.identity, config.recoveryRequested)
let lastPulse = performance.now()
let lastTick = lastPulse
let quietUntil = lastPulse + 30000
let helper: ReturnType<typeof spawn> | undefined
let host: string | undefined
let pending = false
let pendingKind = ''
let restart = false
let parentAlive = true
let clean = false
let termination: Promise<void> | undefined
const send = (value: object) => {
    if (process.connected) process.send?.(value)
}
const launchArgs = (recovery: boolean) => [
    ...(!config.packaged ? [recovery && config.testEntry ? config.testEntry : config.appPath] : []),
    ...(recovery ? ['--gitorian-recovery'] : [])
]
async function launchJournal() {
    const env: NodeJS.ProcessEnv = { ...process.env, GITORIAN_RECOVERY_START: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.GITORIAN_RECOVERY_PROFILE
    const next = spawn(config.executable, launchArgs(false), {
        env,
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
    })
    await new Promise<void>((done, failed) => {
        next.once('spawn', done)
        next.once('error', failed)
    })
    next.unref()
}
function exitWatchdog() {
    clearInterval(timer)
    const active = helper
    if (active && active.exitCode === null) {
        active.once('exit', () => process.exit(0))
        active.kill()
        setTimeout(() => process.exit(0), 2000).unref()
    } else process.exit(0)
}
function recover() {
    if (helper || performance.now() < quietUntil) return
    try {
        host = mkdtempSync(join(tmpdir(), 'gitorian-recovery-'))
    } catch {
        host = undefined
    }
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        GITORIAN_RECOVERY_PROFILE: config.profile,
        GITORIAN_RECOVERY_HOST: host
    }
    delete env.ELECTRON_RUN_AS_NODE
    helper = spawn(config.executable, launchArgs(true), {
        env,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    helper.on('error', () => {
        reports.failure('recovery-ui')
        helper = undefined
        quietUntil = performance.now() + 30000
    })
    helper.on('message', async (message) => {
        if (message === 'get-report') {
            if (helper?.connected)
                helper.send(
                    {
                        type: 'report',
                        text: reports.report(),
                        responsive: parentAlive && performance.now() - lastPulse < 8000
                    },
                    () => undefined
                )
        } else if (message === 'restart') {
            if (restart) return
            restart = true
            if (!parentAlive) {
                try {
                    await launchJournal()
                    exitWatchdog()
                } catch {
                    restart = false
                    reports.failure('restart-failed')
                }
                return
            }
            reports.pause()
            termination = terminateDesktop(
                config.parent,
                () => process.connected,
                () => send({ type: 'shutdown' })
            )
            void termination.catch(() => {
                restart = false
                reports.failure('restart-failed')
            })
        }
    })
    helper.on('exit', () => {
        helper = undefined
        quietUntil = performance.now() + 30000
        if (host) {
            try {
                const target = resolve(host)
                if (
                    dirname(target) === resolve(tmpdir()) &&
                    basename(target).startsWith('gitorian-recovery-') &&
                    !lstatSync(target).isSymbolicLink()
                )
                    rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
            } catch {
                /* OS may retain a final handle. */
            }
        }
        if (!parentAlive && !restart) process.exit(0)
    })
}
send({
    type: 'ready',
    recovery: reports.recoveryPending,
    available: reports.available,
    recoveryNoticeId: reports.recoveryNoticeId
})
process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return
    if (message.type === 'pulse') {
        if (pendingKind === 'main' && performance.now() - lastPulse > 20000) {
            pending = false
            pendingKind = ''
            reports.observe({ type: 'health', operation: 'main', phase: 'responsive' })
            if (helper?.connected) helper.send({ type: 'responsive' }, () => undefined)
        }
        lastPulse = performance.now()
    } else if (message.type === 'observe' && 'event' in message) {
        reports.observe(message.event as Parameters<IncidentReports['observe']>[0])
        if ('dropped' in message && typeof message.dropped === 'number') reports.lost(message.dropped)
        const event = message.event
        if (
            pendingKind === 'renderer-hang' &&
            event &&
            typeof event === 'object' &&
            'operation' in event &&
            event.operation === 'renderer' &&
            'phase' in event &&
            event.phase === 'responsive'
        ) {
            pending = false
            pendingKind = ''
            if (helper?.connected) helper.send({ type: 'responsive' }, () => undefined)
        }
    } else if (message.type === 'incident' && 'kind' in message && typeof message.kind === 'string') {
        reports.incident(message.kind)
        if (['renderer-hang', 'renderer-crash', 'storage-stall', 'startup-failure'].includes(message.kind)) {
            pending = true
            pendingKind = message.kind
            recover()
        }
    } else if (message.type === 'finish') {
        clean = true
        reports.finish()
        // Journal storage and accepted work have already closed. Exit before installer/profile cleanup.
        if (restart) {
            send({ type: 'restart-finishing' })
            return
        }
        exitWatchdog()
    } else if (message.type === 'resume') {
        quietUntil = performance.now() + 30000
        lastPulse = performance.now()
    } else if (message.type === 'continue') reports.resume()
    else if (message.type === 'pause') reports.pause()
    else if (message.type === 'report' && 'id' in message && typeof message.id === 'string')
        send({ id: message.id, text: reports.report(), available: reports.available })
})
const timer = setInterval(() => {
    const now = performance.now()
    if (now - lastTick > 10000) {
        quietUntil = now + 30000
        lastPulse = now
    }
    lastTick = now
    if (parentAlive && now - lastPulse > 20000) {
        reports.incident('main-hang')
        pending = true
        pendingKind = 'main'
    }
    if (pending) recover()
    reports.flush()
}, 1000)
process.on('disconnect', async () => {
    parentAlive = false
    clearInterval(timer)
    if (clean) reports.finish()
    else {
        reports.incident(restart ? 'forced-restart' : 'unexpected-exit')
        reports.pause()
    }
    reports.release()
    if (restart) {
        try {
            await termination
            await launchJournal()
            exitWatchdog()
            return
        } catch {
            restart = false
            clean = false
            reports.failure('restart-failed')
        }
    }
    if (clean) {
        exitWatchdog()
        return
    }
    pending = true
    quietUntil = 0
    recover()
    // Keep the independent Copy/Save/Open controls alive after the desktop has exited.
    setTimeout(() => process.exit(0), 600000).unref()
})
