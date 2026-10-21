import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve('.')
const scratch = mkdtempSync(join(tmpdir(), 'weekly-j-dev-'))
const evidenceRoot = join(root, '.ai-docs', 'verification')
mkdirSync(evidenceRoot, { recursive: true })
const output = mkdtempSync(join(evidenceRoot, 'dev-launch-'))
const port = await new Promise((done) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port
        probe.close(() => done(port))
    })
})
const origin = `http://127.0.0.1:${port}`
const env = {
    ...process.env,
    NOTION_OAUTH_PORT: String(port),
    NOTION_OAUTH_ORIGIN: origin,
    NOTION_CLIENT_ID: 'fixture-development-app',
    NOTION_CLIENT_SECRET: 'fixture-development-secret',
    NOTION_STATE_SECRET: 'fixture-development-state-secret-at-least-32-characters',
    WEEKLY_J_DEV_PROFILE: join(scratch, 'profile')
}
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(process.execPath, ['tools/dev.mjs'], {
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
})
const report = { command: 'pnpm smoke:dev-launch', pid: child.pid, scratch, passed: false }
let logs = ''
child.stdout.on('data', (chunk) => {
    logs += String(chunk)
})
child.stderr.on('data', (chunk) => {
    logs += String(chunk)
})
const exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })))
try {
    const started = Date.now()
    while (!existsSync(join(scratch, 'profile', 'weekly-j.sqlite'))) {
        if (Date.now() - started > 45000 || child.exitCode !== null)
            throw new Error('The isolated development desktop did not start.')
        await delay(100)
    }
    const health = await fetch(`${origin}/health`)
    if (!health.ok || !(await health.json()).ready) throw new Error('Local OAuth health failed')
    const authorization = await fetch(
        `${origin}/authorize?port=12345&nonce=${'n'.repeat(32)}&challenge=${'c'.repeat(43)}`,
        { redirect: 'manual' }
    )
    const notion = new URL(authorization.headers.get('Location'))
    if (
        authorization.status !== 302 ||
        notion.origin !== 'https://api.notion.com' ||
        notion.searchParams.get('redirect_uri') !== `${origin}/callback`
    )
        throw new Error('Local OAuth used the wrong registration redirect')
    report.readyMs = Date.now() - started
    report.health = true
    report.authorizationRedirect = { origin: notion.origin, redirectUri: notion.searchParams.get('redirect_uri') }
    // Exiting the owned OAuth child must also stop the desktop via the real root dev launcher.
    const oauthPid = Number(/Notion OAuth listening .*\(PID (\d+)\)/.exec(logs)?.[1])
    if (!oauthPid) throw new Error('Missing owned OAuth child PID')
    report.oauthPid = oauthPid
    if (process.platform === 'win32')
        execFileSync('taskkill', ['/PID', String(oauthPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(oauthPid, 'SIGTERM')
    report.exit = await exited
    await delay(250)
    try {
        await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })
        throw new Error('Development OAuth listener survived cleanup')
    } catch (error) {
        if (error.message === 'Development OAuth listener survived cleanup') throw error
    }
    report.passed = true
} catch (error) {
    report.error = String(error)
} finally {
    if (child.exitCode === null && child.signalCode === null) {
        try {
            if (process.platform === 'win32')
                execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore'
                })
            else child.kill('SIGTERM')
        } catch {
            /* The owned process may already have exited. */
        }
        await exited
    }
    writeFileSync(join(output, 'output.log'), logs)
    const target = resolve(scratch)
    if (dirname(target) !== resolve(tmpdir()) || !target.startsWith(resolve(tmpdir()) + sep + 'weekly-j-dev-')) {
        report.cleanupError = 'Refusing cleanup outside owned development fixture'
    } else {
        try {
            rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
        } catch (error) {
            report.cleanupError = String(error)
        }
    }
    report.cleanup = { removed: !existsSync(target) }
    report.passed &&= report.cleanup.removed
    writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
    console.info(JSON.stringify({ ...report, evidence: output }, null, 2))
    process.exitCode = report.passed ? 0 : 1
}
