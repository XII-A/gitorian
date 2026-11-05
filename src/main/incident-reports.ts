import { randomUUID } from 'node:crypto'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { DiagnosticObservation } from '../shared/diagnostics'

export function failureObservation(
    operation: string,
    error?: unknown,
    files: ReadonlySet<string> = new Set(['index.js'])
): DiagnosticObservation {
    const frames: string[] = []
    if (error instanceof Error) {
        const prefix = `${error.name}: ${error.message}`
        const stack = error.stack?.startsWith(prefix) ? error.stack.slice(prefix.length) : ''
        for (const line of stack.split('\n').slice(0, 24)) {
            if (line.length > 2048 || !/^\s+at /.test(line)) continue
            const match = /[\\/]out[\\/]main[\\/]([a-zA-Z0-9_.-]{1,100}\.js):(\d{1,8}):(\d{1,8})\)?$/.exec(line)
            if (match && files.has(match[1])) frames.push(`app:${match[1]}:${match[2]}:${match[3]}`)
            if (frames.length === 12) break
        }
    }
    return { type: 'failure', operation, phase: 'failed', frames }
}

const observation = z.object({
    type: z.enum(['operation', 'failure', 'health', 'source']),
    operation: z.string().regex(/^[a-zA-Z][a-zA-Z0-9:.-]{0,63}$/),
    phase: z.enum(['begin', 'end', 'failed', 'stalled', 'responsive']),
    operationId: z
        .string()
        .regex(/^[a-zA-Z0-9:-]{1,64}$/)
        .optional(),
    durationMs: z.number().min(0).max(86400000).optional(),
    frames: z
        .array(
            z
                .string()
                .max(128)
                .regex(/^app:[a-zA-Z0-9_.-]+\.js:\d+:\d+$/)
        )
        .max(12)
        .optional()
})
const record = z.object({
    reportVersion: z.literal(1),
    id: z.uuid(),
    time: z.string(),
    detectedAt: z.string().max(40).optional(),
    app: z.object({
        version: z.string().max(32),
        platform: z.string().max(32),
        build: z.string().max(64),
        electron: z.string().max(32).optional(),
        node: z.string().max(32).optional(),
        architecture: z.string().max(16).optional(),
        os: z.string().max(64).optional()
    }),
    clean: z.boolean(),
    recovery: z.boolean().default(false),
    incident: z.string().max(64).optional(),
    dropped: z.number(),
    events: z.array(observation.extend({ at: z.string() })).max(200)
})
type Record = z.infer<typeof record>

/** A fixed privacy projection, bounded persistence and one copy/export representation. */
export class IncidentReports {
    readonly previousUnexpected: boolean
    readonly recoveryNoticeId?: string
    available = true
    private readonly current: Record
    private previous?: Record
    private released = false
    constructor(
        private readonly directory: string,
        identity: Record['app'],
        recoveryRequested = false
    ) {
        let prior: Record | undefined
        let corrupt = false
        try {
            const file = join(directory, 'current.json')
            if (existsSync(file)) {
                const bytes = readFileSync(file)
                if (bytes.length > 131072) throw new Error('Oversized record')
                prior = record.parse(JSON.parse(bytes.toString('utf8')))
            }
        } catch {
            corrupt = true
        }
        this.previousUnexpected = corrupt || (!!prior && !prior.clean)
        this.previous = prior?.incident ? prior : undefined
        if (!this.previous) {
            try {
                const latest = readdirSync(directory)
                    .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
                    .sort((a, b) => statSync(join(directory, b)).mtimeMs - statSync(join(directory, a)).mtimeMs)[0]
                if (latest) {
                    const bytes = readFileSync(join(directory, latest))
                    if (bytes.length < 131072) this.previous = record.parse(JSON.parse(bytes.toString('utf8')))
                }
            } catch {
                /* A missing archive never prevents journal startup. */
            }
        }
        this.recoveryNoticeId = this.previousUnexpected ? (prior?.id ?? randomUUID()) : undefined
        if (this.previousUnexpected && prior) {
            prior.incident ??= 'unexpected-exit'
            prior.detectedAt ??= new Date().toISOString()
            this.previous = prior
        }
        this.current = {
            reportVersion: 1,
            id: randomUUID(),
            time: new Date().toISOString(),
            app: identity,
            clean: false,
            recovery: recoveryRequested || this.previousUnexpected || !!prior?.recovery,
            incident: corrupt ? 'previous-report-unavailable' : undefined,
            dropped: 0,
            events: []
        }
        if (this.previousUnexpected && prior) {
            try {
                mkdirSync(directory, { recursive: true, mode: 0o700 })
                writeFileSync(join(directory, `${prior.id}.json`), JSON.stringify(prior), { mode: 0o600 })
            } catch {
                this.available = false
            }
        }
        this.persist()
    }
    get recoveryPending() {
        return this.current.recovery
    }
    resume() {
        this.current.recovery = false
        this.persist()
    }
    pause() {
        this.current.recovery = true
        this.persist()
    }
    flush() {
        this.persist()
    }
    /** Retain Copy/Save in memory after the journal exits without competing with its next session. */
    release() {
        this.released = true
    }
    lost(count: number) {
        if (Number.isSafeInteger(count) && count > 0) this.current.dropped += Math.min(count, 1000000)
    }
    observe(input: DiagnosticObservation) {
        const parsed = observation.safeParse(input)
        if (!parsed.success) return
        this.current.events.push({ ...parsed.data, at: new Date().toISOString() })
        if (this.current.events.length > 200) {
            const expendable = this.current.events.findIndex((event) => event.type !== 'failure')
            this.current.events.splice(Math.max(0, expendable), 1)
            this.current.dropped++
        }
        while (Buffer.byteLength(JSON.stringify(this.current, null, 2)) > 120000 && this.current.events.length) {
            this.current.events.shift()
            this.current.dropped++
        }
    }
    failure(operation: string, error?: unknown) {
        this.observe(failureObservation(operation, error))
        this.incident(operation)
    }
    incident(kind: string) {
        if (!/^[a-zA-Z][a-zA-Z0-9:.-]{0,63}$/.test(kind)) return
        if (this.current.incident !== kind) this.current.detectedAt = new Date().toISOString()
        this.current.incident = kind
        this.persist()
    }
    finish() {
        this.current.clean = true
        this.persist()
    }
    report() {
        return JSON.stringify(
            {
                ...(this.current.incident ? this.current : (this.previous ?? this.current)),
                storage: this.available ? 'local' : 'storage-unavailable',
                sample: 'unavailable'
            },
            null,
            2
        )
    }
    private persist() {
        if (this.released) return
        try {
            mkdirSync(this.directory, { recursive: true, mode: 0o700 })
            const file = join(this.directory, 'current.json')
            writeFileSync(file + '.next', JSON.stringify(this.current), { mode: 0o600 })
            renameSync(file + '.next', file)
            // Exportable snapshot is independently readable when main is blocked or has exited.
            writeFileSync(join(this.directory, 'report.txt.next'), this.report(), { mode: 0o600 })
            renameSync(join(this.directory, 'report.txt.next'), join(this.directory, 'report.txt'))
            if (this.current.incident) {
                writeFileSync(join(this.directory, `${this.current.id}.json`), this.report(), { mode: 0o600 })
            }
            const files = readdirSync(this.directory)
                .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
                .sort((a, b) => statSync(join(this.directory, a)).mtimeMs - statSync(join(this.directory, b)).mtimeMs)
            for (const file of [...files])
                if (Date.now() - statSync(join(this.directory, file)).mtimeMs > 14 * 86400000) {
                    unlinkSync(join(this.directory, file))
                    files.splice(files.indexOf(file), 1)
                }
            while (files.length > 10) unlinkSync(join(this.directory, files.shift()!))
        } catch {
            this.available = false
        }
    }
}
