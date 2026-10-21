import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const origin = `http://127.0.0.1:${process.env.NOTION_OAUTH_PORT ?? 8788}`
const profile = process.env.WEEKLY_J_DEV_PROFILE ?? join(process.cwd(), '.ai-docs', 'development-profile')
mkdirSync(profile, { recursive: true })
const children = new Set()
let stopping = false
function stop(code = 0) {
    if (stopping) return
    stopping = true
    for (const child of children) {
        if (!child.pid) continue
        try {
            if (process.platform === 'win32')
                execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore'
                })
            else process.kill(-child.pid, 'SIGTERM')
        } catch {
            /* A child can exit before its sibling is terminated. */
        }
    }
    process.exitCode = code
}
function launch(args, extraEnv = {}) {
    const env = { ...process.env, ...extraEnv }
    delete env.ELECTRON_RUN_AS_NODE
    if (extraEnv.WEEKLY_J_DEV_PROFILE) {
        delete env.NOTION_CLIENT_SECRET
        delete env.NOTION_STATE_SECRET
    }
    const child = spawn(process.execPath, args, {
        env,
        stdio: 'inherit',
        windowsHide: true,
        detached: process.platform !== 'win32'
    })
    children.add(child)
    child.once('error', (error) => {
        console.error(error.message)
        stop(1)
    })
    child.once('exit', (code) => {
        children.delete(child)
        stop(code ?? 1)
    })
    return child
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
launch(['--env-file-if-exists=services/notion-oauth/.env.local', '--import', 'tsx', 'services/notion-oauth/src/dev.ts'])
try {
    let ready = false
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
        try {
            // 503 is an intentional unconfigured-development response, not a fake Notion connection.
            const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })
            if (response.status === 200 || response.status === 503) {
                ready = true
                break
            }
        } catch {
            /* Wait for the owned OAuth child to bind. */
        }
        await delay(100)
    }
    if (!ready) throw new Error('The local Notion OAuth module did not start.')
    if (!stopping)
        launch(
            [join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js'), 'dev', '--watch'],
            { WEEKLY_J_NOTION_OAUTH_ORIGIN: process.env.NOTION_OAUTH_ORIGIN ?? origin, WEEKLY_J_DEV_PROFILE: profile }
        )
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    stop(1)
}
