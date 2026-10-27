import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
// Build main/preload/worker with `pnpm build`, then run `pnpm smoke:writing`.
// This starts its own Vite development renderer and isolated synthetic journal.
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'dev-current'
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(label))
    throw Error('Profile label must contain only letters, digits, underscores or hyphens')
mkdirSync(resolve('.ai-docs'), { recursive: true })
execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/workspace-writing-fixture.ts'], {
    windowsHide: true,
    stdio: 'pipe'
})
const server = await createServer({
    configFile: false,
    root: resolve('src/renderer'),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 4189, strictPort: true },
    clearScreen: false
})
await server.listen()
const env = {
    ...process.env,
    ELECTRON_RENDERER_URL: 'http://127.0.0.1:4189',
    WRITING_RENDERER_URL: 'http://127.0.0.1:4189',
    WRITING_PROFILE_LABEL: label,
    WRITING_PROFILE_ASSERT: process.argv.includes('--assert') ? '1' : '0'
}
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [resolve('tools/workspace-writing-electron.mjs')], {
    env,
    windowsHide: true,
    stdio: 'inherit'
})
const deadline = setTimeout(() => {
    console.error('Writing replay exceeded its process deadline')
    if (child.pid && child.exitCode === null) {
        if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
    }
}, 120000)
child.on('exit', async (code) => {
    clearTimeout(deadline)
    await server.close()
    process.exitCode = code ?? 1
})
