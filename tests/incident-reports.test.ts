import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { IncidentReports, failureObservation } from '../src/main/incident-reports'
import { RecoveryAdmission } from '../src/main/recovery-admission'
import { hubRepository } from './hub-fixtures'

it('continues only explicitly resumed sources and presents other retained work as stopped', () => {
    const policy = new RecoveryAdmission(true)
    const state = {
        repositories: [hubRepository(0, { id: 'held' }), hubRepository(1, { id: 'resumed' })],
        accounts: [],
        acquisition: {
            'git:held': { status: 'idle' as const, windowEnd: '2026-11-02T12:00:00Z' },
            'git:resumed': { status: 'idle' as const, windowEnd: '2026-11-02T12:00:00Z' }
        }
    }
    expect(policy.next(state, Date.now())).toBeUndefined()
    expect(policy.project(state.acquisition)['git:held'].status).toBe('cancelled')
    expect(state.acquisition['git:held'].status).toBe('idle')
    policy.resume('git', 'resumed')
    expect(policy.next(state, Date.now())?.[0]).toBe('git:resumed')
    expect(policy.project(state.acquisition)['git:resumed'].status).toBe('idle')
    policy.continueNormally()
    expect(policy.next(state, Date.now())?.[0]).toBe('git:held')
})

it('projects only known application frames after the complete error message', () => {
    const error = new Error('private C:\\out\\main\\PRIVATE_CANARY.js:1:2\n at C:\\out\\main\\index.js:3:4')
    error.stack = `${error.name}: ${error.message}\n at acquire (C:\\public\\out\\main\\index.js:5:6)\n at C:\\out\\main\\${'x'.repeat(140000)}.js:1:2`
    expect(failureObservation('background', error).frames).toEqual(['app:index.js:5:6'])
})

it('archives an unexpected exit across clean recovery sessions until explicitly resumed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-incidents-'))
    const identity = { version: 'test', platform: 'win32', build: 'fixture' }
    try {
        new IncidentReports(directory, identity)
        const recovered = new IncidentReports(directory, identity)
        expect(recovered.recoveryNoticeId).toBeTruthy()
        recovered.finish()
        const reopened = new IncidentReports(directory, identity)
        expect(reopened.recoveryPending).toBe(true)
        expect(reopened.recoveryNoticeId).toBeUndefined()
        expect(reopened.report()).toContain('unexpected-exit')
        reopened.resume()
        reopened.finish()
        expect(new IncidentReports(directory, identity).recoveryPending).toBe(false)
        const crashedAgain = new IncidentReports(directory, identity)
        expect(crashedAgain.recoveryNoticeId).toBeTruthy()
        expect(crashedAgain.recoveryNoticeId).not.toBe(recovered.recoveryNoticeId)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

it('retains an unexpected session without persisting error content and bounds observations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-incidents-'))
    try {
        const reports = new IncidentReports(directory, { version: 'test', platform: 'win32', build: 'fixture' })
        expect(reports.previousUnexpected).toBe(false)
        reports.observe({ type: 'operation', operation: 'loadWeek', phase: 'begin' })
        const error = new Error('secret-token and private journal text at C:\\Users\\private')
        error.stack = 'Error: private\n at acquire (C:\\Users\\private\\out\\main\\index.js:23:4)'
        reports.failure('background', error)
        for (let i = 0; i < 500; i++) reports.observe({ type: 'operation', operation: 'state', phase: 'end' })
        const text = reports.report()
        expect(text).not.toMatch(/secret-token|private journal|Users|private/)
        expect(JSON.parse(text).dropped).toBeGreaterThan(0)
        expect(text.length).toBeLessThan(131072)
        const restarted = new IncidentReports(directory, { version: 'test', platform: 'win32', build: 'fixture' })
        expect(restarted.previousUnexpected).toBe(true)
        expect(restarted.report()).toContain('background')
        restarted.finish()
        const clean = new IncidentReports(directory, { version: 'test', platform: 'win32', build: 'fixture' })
        expect(clean.previousUnexpected).toBe(false)
        expect(clean.recoveryPending).toBe(true)
        expect(clean.report()).toContain('background')
        clean.resume()
        clean.finish()
        expect(
            new IncidentReports(directory, { version: 'test', platform: 'win32', build: 'fixture' }).recoveryPending
        ).toBe(false)
        expect(await readFile(join(directory, 'current.json'), 'utf8')).not.toContain('secret-token')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

it('opens with unavailable diagnostics when records are corrupt or storage cannot be written', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-incidents-'))
    try {
        await writeFile(join(directory, 'current.json'), '{torn')
        const reports = new IncidentReports(directory, { version: 'test', platform: 'win32', build: 'fixture' })
        expect(reports.previousUnexpected).toBe(true)
        const blocked = join(directory, 'not-a-directory')
        await writeFile(blocked, 'fixture')
        const unavailable = new IncidentReports(blocked, { version: 'test', platform: 'win32', build: 'fixture' })
        expect(unavailable.available).toBe(false)
        expect(unavailable.report()).toContain('storage-unavailable')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

it('keeps the previous crash report shareable without overwriting a manually reopened session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-incidents-'))
    const identity = { version: 'test', platform: 'win32', build: 'fixture' }
    try {
        const prior = new IncidentReports(directory, identity)
        prior.incident('unexpected-exit')
        prior.pause()
        prior.release()
        const next = new IncidentReports(directory, identity)
        const marker = await readFile(join(directory, 'current.json'), 'utf8')
        prior.failure('restart-failed')
        prior.flush()
        expect(await readFile(join(directory, 'current.json'), 'utf8')).toBe(marker)
        expect(prior.report()).toContain('restart-failed')
        expect(next.recoveryPending).toBe(true)
        expect(next.report()).toContain('unexpected-exit')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

it('keeps recovery admission source-scoped until the user explicitly resumes normal work', () => {
    const policy = new RecoveryAdmission(true)
    expect(policy.permits('git', 'one')).toBe(false)
    policy.resume('git', 'one')
    expect(policy.permits('git', 'one')).toBe(true)
    expect(policy.permits('remote', 'one')).toBe(false)
    expect(policy.permits('git', 'two')).toBe(false)
    expect(policy.normal).toBe(false)
    policy.continueNormally()
    expect(policy.permits('remote', 'two')).toBe(true)
    expect(policy.normal).toBe(true)
})
