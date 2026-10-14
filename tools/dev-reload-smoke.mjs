import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'

// Exercise shared command changes through the real development runner and Electron IPC.
// Temporary source, builds, and user data stay isolated from the running app.

const root = resolve('.')
await mkdir(join(root, '.ai-docs'), { recursive: true })
const fixture = await mkdtemp(join(root, '.ai-docs', 'dev-reload-'))
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))
const currentModel = await readFile(join(root, 'src/shared/model.ts'), 'utf-8')
const oldModel = currentModel.replace(/\s*z\.object\(\{ type: z\.literal\('addRepositories'\) \}\),/u, '')
const modelPath = join(fixture, 'model.ts')
const entry = join(fixture, 'out/main/main.js')
let child
let output = ''
const pause = (time) =>
    Promise.resolve(
        (() => {
            const { promise, resolve: done, reject } = Promise.withResolvers()
            try {
                setTimeout(done, time)
            } catch (error) {
                reject(error)
            }
            return promise
        })()
    )
const waitFor = async (text, timeout) => {
    const start = Date.now()
    while (!output.includes(text)) {
        if (Date.now() - start > timeout) {
            throw new Error(`Timed out waiting for ${text}`)
        }
        await pause(50)
    }
}
try {
    await writeFile(modelPath, oldModel)
    await writeFile(join(fixture, 'index.html'), '<!doctype html><html><body>IPC reload fixture</body></html>')
    await writeFile(
        join(fixture, 'preload.ts'),
        `import { contextBridge, ipcRenderer } from 'electron';contextBridge.exposeInMainWorld('journal', {invoke: input=>ipcRenderer.invoke('journal:command',input)})`
    )
    await writeFile(
        join(fixture, 'main.ts'),
        `
        import { app, BrowserWindow, ipcMain } from 'electron'
        import { join } from 'node:path'
        import { fileURLToPath } from 'node:url'
        import { commandSchema } from './model'
        const directory=fileURLToPath(new URL('.',import.meta.url))
        app.setPath('userData',${JSON.stringify(join(fixture, 'user-data'))})
        app.whenReady().then(async()=>{
            ipcMain.handle('journal:command',(_,input)=>commandSchema.parse(input))
            const window=new BrowserWindow({show:false,webPreferences:{preload:join(directory,'../preload/index.cjs'),sandbox:true,contextIsolation:true}})
            await window.loadFile(${JSON.stringify(join(fixture, 'index.html'))})
            const result=await window.webContents.executeJavaScript("window.journal.invoke({type:'addRepositories'}).then(()=> 'accepted').catch(error => String(error).includes('invalid_union') && String(error).includes('Invalid discriminator value') ? 'rejected-old-schema' : 'unexpected-error')")
            console.log('[DEV-RELOAD] '+result)
        })
    `
    )
    await writeFile(
        join(fixture, 'electron.vite.config.mjs'),
        `
        import {defineConfig} from 'electron-vite'
        export default defineConfig({
            main:{build:{externalizeDeps:true,outDir:${JSON.stringify(join(fixture, 'out/main'))},rollupOptions:{input:${JSON.stringify(join(fixture, 'main.ts'))}}}},
            preload:{build:{externalizeDeps:true,outDir:${JSON.stringify(join(fixture, 'out/preload'))},rollupOptions:{input:${JSON.stringify(join(fixture, 'preload.ts'))},output:{format:'cjs',entryFileNames:'index.cjs'}}}}
        })
    `
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(
        process.execPath,
        [
            join(root, 'node_modules/electron-vite/bin/electron-vite.js'),
            ...packageInfo.scripts.dev.split(/\s+/u).slice(1),
            '--config',
            join(fixture, 'electron.vite.config.mjs'),
            '--entry',
            entry
        ],
        { cwd: root, detached: process.platform !== 'win32', env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (chunk) => {
            output += String(chunk)
        })
    }
    await waitFor('[DEV-RELOAD] rejected-old-schema', 15_000)
    console.info('Reproduced the invalid command discriminator through Electron IPC.')
    await writeFile(modelPath, currentModel)
    await waitFor('[DEV-RELOAD] accepted', 5000)
    console.info('PASS: changing the shared schema restarts the backend and folder import is accepted.')
} catch (error) {
    console.error(error.message)
    console.error(output.slice(-1500))
    process.exitCode = 1
} finally {
    if (child?.pid !== undefined) {
        try {
            if (process.platform === 'win32') {
                execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                    stdio: 'ignore',
                    windowsHide: true
                })
            } else {
                process.kill(-child.pid, 'SIGTERM')
            }
        } catch {
            // The fixture process may already have exited.
        }
        await pause(500)
    }
    const target = resolve(fixture)
    if (!target.startsWith(resolve(root, '.ai-docs') + sep) || !target.includes('dev-reload-')) {
        console.error('Unsafe fixture cleanup path')
        process.exitCode = 1
    } else {
        await rm(target, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
    }
}
