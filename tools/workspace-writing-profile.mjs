import electron from 'electron'
import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'

// Production renderer, real IPC/worker, isolated synthetic journal; same input guard as development.
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'release-current'
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(label)) throw Error('Invalid profile label')
mkdirSync(resolve('.ai-docs'), { recursive: true })
execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/workspace-writing-fixture.ts'], {
    windowsHide: true,
    stdio: 'pipe'
})
const env = {
    ...process.env,
    WRITING_RENDERER_URL: pathToFileURL(resolve('out/renderer/index.html')).href,
    WRITING_PROFILE_LABEL: label,
    WRITING_PROFILE_ASSERT: process.argv.includes('--assert') ? '1' : '0'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const child = spawn(electron, [resolve('tools/workspace-writing-electron.mjs')], {
    env,
    windowsHide: true,
    stdio: 'inherit'
})
child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
})
const deadline = setTimeout(() => {
    console.error('Writing replay exceeded its process deadline')
    if (child.pid && child.exitCode === null) {
        if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
    }
}, 120000)
child.on('exit', (code) => {
    clearTimeout(deadline)
    process.exitCode = code ?? 1
})
