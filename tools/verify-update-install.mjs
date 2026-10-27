import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

// Installed, unsigned NSIS -> real download -> real installer -> real relaunch.
// A distinct product/app ID, disabled shortcuts, and hardcoded disposable paths
// keep this journey separate from any personal Gitorian installation.
if (process.platform !== 'win32') throw new Error('This journey requires Windows')
const root = resolve('.')
mkdirSync(join(root, '.ai-docs/verification'), { recursive: true })
const output = mkdtempSync(join(root, '.ai-docs/verification/update-install-'))
const scratch = mkdtempSync(join(tmpdir(), 'gitorian-update-install-'))
const profile = join(scratch, 'profile')
const installed = join(scratch, 'installed')
const wrapper = join(root, 'out/main/update-verification.mjs')
let ownsWrapper = false
const log = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const exited = (child) =>
    child.exitCode !== null
        ? Promise.resolve()
        : new Promise((done, reject) => {
              const timer = setTimeout(() => reject(new Error('Fixture application did not exit')), 60000)
              child.once('exit', () => {
                  clearTimeout(timer)
                  done()
              })
          })
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
env.DEBUG = 'electron-builder'
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml')
const report = {
    command: 'node tools/verify-update-install.mjs',
    scratch,
    output,
    passed: false,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    sourceHashes: Object.fromEntries(
        ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html'].map((file) => [
            file,
            createHash('sha256').update(readFileSync(file)).digest('hex')
        ])
    )
}
const save = () => writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
save()
console.info(`Evidence: ${output}`)
writeFileSync(join(output, 'source.patch'), execFileSync('git', ['diff', '--binary', 'HEAD'], { windowsHide: true }))
writeFileSync(join(output, 'verify-update-install.mjs'), readFileSync(import.meta.filename))
const run = async (file, args, name, timeout = 600000) => {
    log({ command: [file, ...args], name })
    await new Promise((done, reject) => {
        const child = spawn(file, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const timer = setTimeout(() => {
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
            reject(new Error(`${name} timed out`))
        }, timeout)
        for (const stream of [child.stdout, child.stderr])
            stream.on('data', (data) => appendFileSync(join(output, `${name}.log`), data))
        child.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
        })
        child.once('close', (code) => {
            clearTimeout(timer)
            if (code === 0) done()
            else reject(new Error(`${name} exited ${code}`))
        })
    })
}
const files = join(scratch, 'new')
const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://local').pathname).slice(1)
    if (!['latest.yml', 'fixture-0.1.5.exe', 'fixture-0.1.5.exe.blockmap', 'fixture-0.1.4.exe.blockmap'].includes(name))
        return response.writeHead(404).end()
    const source = join(name.includes('0.1.4') ? join(scratch, 'old') : files, name)
    log({ http: request.url })
    if (!existsSync(source)) return response.writeHead(404).end()
    const bytes = readFileSync(source)
    // A full installer download is exercised; differential download may fall back.
    response
        .writeHead(200, {
            'Content-Length': bytes.length,
            'Content-Type': name.endsWith('yml') ? 'application/yaml' : 'application/octet-stream'
        })
        .end(bytes)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const portServer = createServer()
await new Promise((done) => portServer.listen(0, '127.0.0.1', done))
const inspectorPort = portServer.address().port
await new Promise((done) => portServer.close(done))
let socket
let evaluate
let fixturePid
let nextId = 1
const connect = async () => {
    for (let i = 0; i < 600; i++) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json()
            socket = new WebSocket(targets[0].webSocketDebuggerUrl)
            await new Promise((done, reject) => {
                socket.addEventListener('open', done, { once: true })
                socket.addEventListener('error', reject, { once: true })
            })
            const pending = new Map()
            socket.addEventListener('message', ({ data }) => {
                const message = JSON.parse(data)
                pending.get(message.id)?.(message)
                pending.delete(message.id)
            })
            evaluate = async (expression) => {
                const id = nextId++
                const result = new Promise((done, reject) => {
                    const timer = setTimeout(() => {
                        pending.delete(id)
                        reject(new Error(`Evaluation timed out: ${expression.slice(0, 150)}`))
                    }, 10000)
                    pending.set(id, (message) => {
                        clearTimeout(timer)
                        done(message)
                    })
                })
                socket.send(
                    JSON.stringify({
                        id,
                        method: 'Runtime.evaluate',
                        params: { expression, awaitPromise: true, returnByValue: true }
                    })
                )
                const message = await result
                if (message.error || message.result.exceptionDetails) throw new Error(JSON.stringify(message))
                return message.result.result.value
            }
            await evaluate(
                `globalThis.__electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron'); process.pid`
            )
            fixturePid = await evaluate('process.pid')
            return
        } catch {
            socket?.close()
            await pause(100)
        }
    }
    throw new Error('Packaged app inspector did not open')
}
const js = (expression) =>
    evaluate(`__electron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(expression)})`)
const wait = async (expression) => {
    for (let i = 0; i < 600; i++) {
        try {
            if (await js(expression)) return
        } catch {
            /* startup/navigation */
        }
        await pause(100)
    }
    throw new Error(`Timed out: ${expression}`)
}
const assert = (value, description) => {
    log({ assertion: description, passed: !!value })
    if (!value) throw new Error(description)
}
const screenshot = async (name) => {
    for (let i = 0; i < 5; i++) {
        await evaluate(`__electron.BrowserWindow.getAllWindows()[0].webContents.capturePage(); true`)
        await pause(100)
    }
    const data = await evaluate(
        `(async()=>{const image=await __electron.BrowserWindow.getAllWindows()[0].webContents.capturePage();return image.toPNG().toString('base64')})()`
    )
    writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'))
}
try {
    if (existsSync(wrapper)) throw new Error('Refusing to replace an existing verification entry')
    mkdirSync(profile, { recursive: true })
    const entry = `import { app } from 'electron'; import inspector from 'node:inspector'; app.setPath('userData', ${JSON.stringify(profile)}); process.env.LOCALAPPDATA=${JSON.stringify(join(scratch, 'cache'))}; inspector.open(${inspectorPort},'127.0.0.1'); app.on('browser-window-created',(_,w)=>{w.show=()=>w.hide();w.webContents.setBackgroundThrottling(false)}); await import('./index.js');`
    writeFileSync(wrapper, entry)
    ownsWrapper = true
    writeFileSync(join(output, 'verification-entry.mjs'), entry)
    for (const [version, name] of [
        ['0.1.4', 'old'],
        ['0.1.5', 'new']
    ]) {
        const config = {
            ...packageJson.build,
            appId: 'io.github.xiia.gitorian.update-verification',
            productName: 'Gitorian Update Verification',
            directories: { output: join(scratch, name) },
            extraMetadata: { version, name: 'gitorian-update-verification', main: 'out/main/update-verification.mjs' },
            nsis: { createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false },
            win: {
                ...packageJson.build.win,
                executableName: 'Gitorian Update Verification',
                artifactName: 'fixture-${version}.exe',
                publish: [{ provider: 'generic', url: origin }]
            }
        }
        const configPath = join(scratch, `${name}.json`)
        writeFileSync(configPath, JSON.stringify(config))
        writeFileSync(join(output, `${name}-config.json`), JSON.stringify(config, null, 2))
        console.info(`Packaging unsigned fixture ${version}`)
        await run(
            process.execPath,
            [
                require.resolve('electron-builder/cli.js'),
                '--config',
                configPath,
                '--win',
                'nsis',
                '--x64',
                '--publish',
                'never'
            ],
            `package-${name}`
        )
        const metadata = yaml.load(readFileSync(join(scratch, name, 'latest.yml'), 'utf8'))
        assert(
            metadata.version === version && metadata.files.length === 1,
            `${version} publishes matching latest.yml metadata`
        )
        const installerPath = join(scratch, name, `fixture-${version}.exe`)
        assert(
            createHash('sha512').update(readFileSync(installerPath)).digest('base64') === metadata.files[0].sha512,
            `${version} installer matches update checksum`
        )
        writeFileSync(join(output, `${name}-latest.yml`), readFileSync(join(scratch, name, 'latest.yml')))
    }
    assert(
        !readFileSync(join(scratch, 'old/win-unpacked/resources/app-update.yml'), 'utf8').includes('publisherName'),
        'Unsigned package does not require an Authenticode publisher'
    )
    console.info('Installing disposable old version')
    await run(join(scratch, 'old/fixture-0.1.4.exe'), ['/S', `/D=${installed}`], 'initial-install', 60000)
    const executable = join(installed, 'Gitorian Update Verification.exe')
    assert(existsSync(executable), 'Initial unsigned installer installs in the owned scratch directory')
    let child = spawn(executable, [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    report.initialPid = child.pid
    for (const stream of [child.stdout, child.stderr])
        stream.on('data', (data) => appendFileSync(join(output, 'app-old.log'), data))
    await connect()
    await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
    assert(
        (await evaluate(`__electron.app.getPath('userData')`)) === profile,
        'Installed app owns only the disposable profile'
    )
    assert(
        (await evaluate(`__electron.app.getVersion()`)) === '0.1.4',
        'Installed baseline reports the old application version'
    )
    await js(`document.querySelector('[aria-label="Open journal"]').click()`)
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Start this week'))`)
    await js(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Start this week')).click()`
    )
    await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
    await js(`document.querySelector('[aria-label="Journal body"]').focus()`)
    await evaluate(
        `__electron.BrowserWindow.getAllWindows()[0].webContents.insertText('Writing before the installed update. '); true`
    )
    await wait(
        `document.querySelector('[aria-label="Journal body"]').innerText.includes('Writing before the installed update.')`
    )
    await wait(`!!document.querySelector('[aria-label="Update ready"]')`)
    await js(`document.querySelector('[aria-label="Update ready"]').click()`)
    await screenshot('installed-update-ready')
    await evaluate(`setTimeout(()=>__electron.app.quit(),100); true`)
    socket.close()
    await exited(child)
    await pause(2000)
    child = spawn(executable, [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr])
        stream.on('data', (data) => appendFileSync(join(output, 'app-resumed.log'), data))
    await connect()
    assert(
        (await evaluate(`__electron.app.getVersion()`)) === '0.1.4',
        'Ordinary exit with an update ready does not install it'
    )
    await wait(`!!document.querySelector('[aria-label="Open journal"]')`)
    await js(`document.querySelector('[aria-label="Open journal"]').click()`)
    await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
    await wait(`!!document.querySelector('[aria-label="Update ready"]')`)
    await js(`document.querySelector('[aria-label="Update ready"]').click()`)
    assert(
        !(await js(`document.querySelector('.journal-notifications')?.innerText.includes('Gitorian 0.1.5 is ready')`)),
        'Ready notification stays dismissed across a full process restart'
    )
    await screenshot('installed-update-popover')
    await js(`document.querySelector('[aria-label="Journal body"]').focus()`)
    await evaluate(
        `__electron.BrowserWindow.getAllWindows()[0].webContents.insertText('Final writing before the real restart.'); true`
    )
    await js(
        `Array.from(document.querySelectorAll('.app-update-popover button')).find(b=>b.textContent==='Update now').click()`
    )
    console.info('Waiting for the real updater installer and relaunch')
    socket.close()
    await exited(child)
    await pause(1000)
    await connect()
    assert((await evaluate(`__electron.app.getVersion()`)) === '0.1.5', 'Real NSIS handoff relaunches the new version')
    await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
    await js(`document.querySelector('[aria-label="Open journal"]').click()`)
    await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
    assert(
        await js(
            `document.querySelector('[aria-label="Journal body"]').innerText.includes('Final writing before the real restart.')`
        ),
        'Last writing survives actual installation and process restart'
    )
    await screenshot('updated-writing-restored')
    await evaluate(`setTimeout(()=>__electron.app.quit(),100); true`)
    socket.close()
    socket = undefined
    await pause(2000)
    const db = new DatabaseSync(join(profile, 'journal.sqlite'), { readOnly: true })
    const drafts = db
        .prepare(
            "SELECT json_object('id',id,'title',title,'body',json(body),'week',week,'version',version,'updatedAt',updatedAt) AS json FROM drafts"
        )
        .all()
        .map((row) => JSON.parse(row.json))
    db.close()
    assert(
        JSON.stringify(drafts).includes('Final writing before the real restart.'),
        'Independent SQLite read confirms writing after real update shutdown'
    )
    writeFileSync(join(output, 'persisted-drafts.json'), JSON.stringify(drafts, null, 2))
    report.passed = true
} catch (error) {
    report.error = String(error)
    console.error(error)
} finally {
    try {
        if (socket?.readyState === WebSocket.OPEN) {
            await evaluate(`setTimeout(()=>__electron.app.exit(),100); true`).catch(() => {
                // A fixture already exiting may close its inspector before replying.
            })
            socket.close()
            await pause(1000)
        } else if (fixturePid) {
            try {
                process.kill(fixturePid)
            } catch {
                /* Already exited. */
            }
        }
        const uninstaller = join(installed, 'Uninstall Gitorian Update Verification.exe')
        if (existsSync(uninstaller)) await run(uninstaller, ['/S'], 'uninstall', 60000)
        // NSIS hands uninstallation to a temporary copy, so its original process
        // can exit before the copy releases the installation directory.
        for (let i = 0; i < 300 && existsSync(join(installed, 'Gitorian Update Verification.exe')); i++)
            await pause(100)
        await pause(1500)
        if (
            dirname(resolve(scratch)) !== resolve(tmpdir()) ||
            !resolve(scratch).startsWith(join(resolve(tmpdir()), 'gitorian-update-install-'))
        )
            report.cleanup = { removed: false, error: 'Refusing cleanup outside owned scratch directory' }
        else {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
            report.cleanup = { removed: !existsSync(scratch) }
        }
    } catch (error) {
        report.cleanup = { removed: false, error: String(error) }
    }
    if (ownsWrapper && existsSync(wrapper)) unlinkSync(wrapper)
    server.closeAllConnections()
    server.close()
    report.finishedAt = new Date().toISOString()
    save()
}
console.info(JSON.stringify(report, null, 2))
if (!report.passed || !report.cleanup?.removed) process.exitCode = 1
