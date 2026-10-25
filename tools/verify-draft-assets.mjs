import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// The production installer changes Windows registration and shortcuts. Never run
// this journey on a personal desktop; the workflow owns a fresh hosted runner.
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Run the Verify exact draft assets workflow on a fresh hosted Windows runner.')
const assets = resolve(process.argv[2])
const output = resolve(process.argv[3])
const tag = process.env.RELEASE_TAG
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Expected a version tag.')
const version = JSON.parse(
    execFileSync('git', ['show', `${tag}:package.json`], { encoding: 'utf8', windowsHide: true })
).version
if (process.env.RELEASE_TAG !== `v${version}`) throw new Error('Tag and package version differ.')
mkdirSync(output, { recursive: true })
const scratch = mkdtempSync(join(tmpdir(), 'gitorian-exact-draft-'))
const installed = join(scratch, 'installed')
const repository = join(scratch, 'release-fixture')
const backup = join(scratch, 'journal-backup.json')
const installer = join(assets, `gitorian-${version}-windows-x64-setup.exe`)
const executable = join(installed, 'Gitorian.exe')
const uninstaller = join(installed, 'Uninstall Gitorian.exe')
const expectedProfile = join(process.env.APPDATA, 'gitorian')
const report = {
    tag: process.env.RELEASE_TAG,
    version,
    scratch,
    output,
    passed: false,
    sourceCommit: execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8', windowsHide: true }).trim(),
    verificationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
    integrationVerification: 'Not tested: no live provider credentials or publishing.'
}
const save = () => writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
const log = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const assert = (value, description) => {
    log({ assertion: description, passed: !!value })
    if (!value) throw new Error(description)
}
const hash = (file, algorithm = 'sha256', encoding = 'hex') =>
    createHash(algorithm).update(readFileSync(file)).digest(encoding)
const powershell = (script) =>
    execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { encoding: 'utf8', windowsHide: true }
    ).trim()
const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name))
)
delete cleanEnv.ELECTRON_RUN_AS_NODE
delete cleanEnv.ELECTRON_RENDERER_URL
const run = async (file, args, name) => {
    log({ command: [file, ...args], name })
    await new Promise((done, reject) => {
        const child = spawn(file, args, { env: cleanEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const timer = setTimeout(() => {
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
            reject(new Error(`${name} timed out`))
        }, 120000)
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
let socket
let child
let profile
let installedOwned = false
let nextId = 1
const pending = new Map()
const command = (method, params = {}) =>
    new Promise((done, reject) => {
        const id = nextId++
        const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Inspector timeout: ${method}`))
        }, 15000)
        pending.set(id, (message) => {
            clearTimeout(timer)
            if (message.error) reject(new Error(JSON.stringify(message.error)))
            else done(message.result)
        })
        socket.send(JSON.stringify({ id, method, params }))
    })
const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
}
const js = (expression) =>
    evaluate(`__electron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(expression)})`)
const wait = async (expression) => {
    for (let attempt = 0; attempt < 600; attempt++) {
        try {
            if (await js(expression)) return
            await evaluate(`__electron.BrowserWindow.getAllWindows()[0].webContents.capturePage();true`)
        } catch {
            /* Startup, layout, or navigation may still be settling. */
        }
        await pause(100)
    }
    throw new Error(`Timed out: ${expression}`)
}
const click = async (selector) => {
    log({ click: selector })
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await pause(150)
}
const button = async (label) => {
    log({ button: label })
    const find = `Array.from(document.querySelectorAll('button')).find(b=>!b.disabled && !b.closest('[inert]') && b.textContent.trim()===${JSON.stringify(label)})`
    await wait(`!!(${find})`)
    await js(`(${find}).click()`)
    await pause(150)
}
const tab = async (label) => {
    log({ tab: label })
    const find = `Array.from(document.querySelectorAll('[role="tab"]')).find(n=>n.textContent.trim()===${JSON.stringify(label)})`
    await wait(`!!(${find})`)
    await js(`(${find}).focus()`)
    await evaluate(
        `(()=>{const contents=__electron.BrowserWindow.getAllWindows()[0].webContents;contents.focus();contents.sendInputEvent({type:'keyDown',keyCode:'Return'});contents.sendInputEvent({type:'char',keyCode:'\\r'});contents.sendInputEvent({type:'keyUp',keyCode:'Return'});return true})()`
    )
    await wait(`(${find})?.getAttribute('aria-selected')==='true'`)
}
const screenshot = async (name) => {
    const data = await evaluate(
        `(async()=>{const image=await __electron.BrowserWindow.getAllWindows()[0].webContents.capturePage();return image.toPNG().toString('base64')})()`
    )
    writeFileSync(join(output, `${name}.png`), Buffer.from(data, 'base64'))
}
const start = async () => {
    const server = createServer()
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const port = server.address().port
    await new Promise((done) => server.close(done))
    child = spawn(executable, [`--inspect=127.0.0.1:${port}`, '--disable-gpu'], {
        env: cleanEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    })
    report.processes ??= []
    report.processes.push(child.pid)
    for (const stream of [child.stdout, child.stderr])
        stream.on('data', (data) => appendFileSync(join(output, 'application.log'), data))
    for (let attempt = 0; attempt < 300; attempt++) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
            socket = new WebSocket(targets[0].webSocketDebuggerUrl)
            await new Promise((done, reject) => {
                socket.addEventListener('open', done, { once: true })
                socket.addEventListener('error', reject, { once: true })
            })
            socket.addEventListener('message', ({ data }) => {
                const message = JSON.parse(data)
                pending.get(message.id)?.(message)
                pending.delete(message.id)
            })
            await evaluate(
                `globalThis.__electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');true`
            )
            break
        } catch {
            socket?.close()
            await pause(100)
        }
    }
    await evaluate(
        `(async()=>{await __electron.app.whenReady();const w=__electron.BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.hide();return true})()`
    )
    await wait(`!!document.querySelector('[aria-label="Open settings"]') && !!window.journal`)
    profile = await evaluate(`__electron.app.getPath('userData')`)
    assert(
        resolve(profile).toLowerCase() === resolve(expectedProfile).toLowerCase(),
        'Packaged app uses the fresh runner profile'
    )
    await evaluate(
        `__electron.dialog.showOpenDialog=async(_w,options)=>({canceled:false,filePaths:[options.properties.includes('openDirectory')?${JSON.stringify(repository)}:${JSON.stringify(backup)}]});__electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});__electron.dialog.showMessageBox=async()=>({response:1});true`
    )
}
const stop = async () => {
    if (!child || child.exitCode !== null) return
    await evaluate(`setTimeout(()=>__electron.app.quit(),0);true`).catch(() => {
        /* Inspector closes during quit. */
    })
    socket?.close()
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) await pause(100)
    if (child.exitCode === null) throw new Error('Packaged app did not quit normally')
}
save()
try {
    assert(!existsSync(expectedProfile), 'No existing Gitorian profile on this disposable runner')
    powershell(
        String.raw`$ErrorActionPreference='Stop'; $roots=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'); foreach($root in $roots){Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {if((Get-ItemProperty -LiteralPath $_.PSPath).DisplayName -match '^Gitorian'){throw 'Existing Gitorian installation. Refusing to replace it.'}}}`
    )
    report.windows = JSON.parse(
        powershell(
            `Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress`
        )
    )
    const expected = [
        `gitorian-${version}-windows-x64-setup.exe`,
        `gitorian-${version}-windows-x64-setup.exe.blockmap`,
        'latest.yml'
    ]
    const sums = readFileSync(join(assets, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/)
    assert(sums.length === expected.length, 'Checksums cover exactly the installer, blockmap and update feed')
    report.hashes = {}
    for (const line of sums) {
        const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line)
        assert(match && expected.includes(match[2]), 'Checksum filename is an expected release asset')
        const actual = hash(join(assets, match[2]))
        assert(actual === match[1], `SHA256 verified: ${match[2]}`)
        report.hashes[match[2]] = actual
    }
    const feed = readFileSync(join(assets, 'latest.yml'), 'utf8')
    assert(feed.split(/\r?\n/).includes(`version: ${version}`), 'Update feed matches the release version')
    const sha512 = /^sha512:\s+(\S+)$/m.exec(feed)?.[1]
    assert(sha512 === hash(installer, 'sha512', 'base64'), 'Update feed SHA512 matches the exact installer')
    report.installerSha256 = hash(installer)
    save()
    await run(installer, ['/S', `/D=${installed}`], 'install')
    installedOwned = true
    assert(
        existsSync(executable) && existsSync(uninstaller),
        'Exact unsigned installer installs its application and uninstaller'
    )
    mkdirSync(repository)
    const git = (...args) => execFileSync('git', ['-C', repository, ...args], { windowsHide: true, encoding: 'utf8' })
    git('init', '-b', 'main')
    git('config', 'user.name', 'Release Fixture')
    git('config', 'user.email', 'release-fixture@example.invalid')
    writeFileSync(join(repository, 'fixture.txt'), 'Initial release fixture\n')
    git('add', '.')
    git('commit', '-m', 'Initial release fixture')
    writeFileSync(join(repository, 'fixture.txt'), 'Initial release fixture\nExact draft asset diff marker\n')
    git('commit', '-am', 'Exact draft asset verification change')
    await start()
    assert(
        (await evaluate(`__electron.app.getVersion()`)) === version,
        'Installed packaged app reports the release version'
    )
    report.profile = profile
    report.initial = await js(`window.journal.invoke({type:'state'})`)
    assert(
        report.initial.state.drafts.length === 0 &&
            !report.initial.connections.github &&
            !report.initial.connections.notion,
        'Installed app starts with disposable data and no credentials'
    )
    await js(`document.querySelector('[aria-label="Dismiss setup"]')?.click()`)
    await click('[aria-label="Open settings"]')
    await tab('Repositories')
    await button('Add repositories from folder')
    await button('Import 1 repository')
    await button('Save settings')
    await wait(`!document.querySelector('.settings')`)
    await click('[aria-label="Refresh activity"]')
    await wait(
        `Array.from(document.querySelectorAll('.hub-activity')).some(n=>n.textContent.includes('Exact draft asset verification change'))`
    )
    await js(
        `Array.from(document.querySelectorAll('.hub-activity')).find(n=>n.textContent.includes('Exact draft asset verification change')).click()`
    )
    await wait(`!!document.querySelector('.hub-detail-files')`)
    await screenshot('01-imported-activity')
    await button('Open in workspace')
    await tab('Diff')
    await wait(`document.body.innerText.includes('Exact draft asset diff marker')`)
    await screenshot('02-real-diff')
    const writing = 'Exact draft asset verification: writing survives a complete restart.'
    await button('Start this week’s entry')
    await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
    await js(`document.querySelector('[aria-label="Journal body"]').focus()`)
    await evaluate(
        `__electron.BrowserWindow.getAllWindows()[0].webContents.insertText(${JSON.stringify(writing)});true`
    )
    await wait(
        `window.journal.invoke({type:'state'}).then(r=>JSON.stringify(r.state.drafts).includes(${JSON.stringify(writing)}))`
    )
    await screenshot('03-writing-saved')
    await stop()
    await start()
    await click('[aria-label="Open journal"]')
    await wait(`document.querySelector('[aria-label="Journal body"]')?.innerText.includes(${JSON.stringify(writing)})`)
    assert(true, 'Native writing survives full process quit and restart')
    await screenshot('04-writing-after-restart')
    await click('[aria-label="Open settings"]')
    await tab('Backup')
    await button('Export backup')
    await wait(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Export backup' && !b.disabled)`
    )
    assert(
        existsSync(backup) && readFileSync(backup, 'utf8').includes(writing),
        'Exported backup contains the disposable writing'
    )
    await button('Import backup')
    await wait(`document.body.innerText.includes('Backup imported.')`)
    const restored = await js(`window.journal.invoke({type:'state'})`)
    assert(
        JSON.stringify(restored.state.drafts).includes(writing) && restored.state.repositories.length === 1,
        'Backup import restores writing and repository tracking'
    )
    await screenshot('05-backup-restored')
    await button('Save settings')
    await stop()
    const db = new DatabaseSync(join(profile, 'gitorian.sqlite'), { readOnly: true })
    const persisted = db
        .prepare("SELECT json FROM state_records WHERE collection='drafts'")
        .all()
        .map((row) => JSON.parse(String(row.json)))
    db.close()
    writeFileSync(join(output, 'persisted-drafts.json'), JSON.stringify(persisted, null, 2))
    assert(
        JSON.stringify(persisted).includes(writing),
        'Independent SQLite read retains the restarted and restored writing'
    )
    await run(uninstaller, ['/S', '/currentuser', `_?=${installed}`], 'uninstall')
    installedOwned = false
    assert(!existsSync(executable), 'Uninstall removes the packaged executable')
    assert(existsSync(join(profile, 'gitorian.sqlite')), 'Normal uninstall preserves journal data')
    assert(hash(installer) === report.installerSha256, 'The verified draft installer bytes remain unchanged')
    report.passed = true
} catch (error) {
    report.error = String(error)
    console.error(error)
    if (socket?.readyState === WebSocket.OPEN)
        await screenshot('failure').catch(() => {
            /* Retain original failure. */
        })
    process.exitCode = 1
} finally {
    await stop().catch(() => {
        if (child?.pid && child.exitCode === null)
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    })
    if (installedOwned && existsSync(uninstaller))
        await run(uninstaller, ['/S', '/currentuser', `_?=${installed}`], 'cleanup-uninstall').catch(() => {
            report.cleanupError = 'Cleanup uninstaller failed; inspect cleanup-uninstall.log.'
            report.passed = false
            process.exitCode = 1
        })
    if (profile && resolve(profile).toLowerCase() === resolve(expectedProfile).toLowerCase())
        rmSync(profile, { recursive: true, force: true })
    if (resolve(scratch).startsWith(resolve(tmpdir()) + sep)) rmSync(scratch, { recursive: true, force: true })
    else {
        report.cleanupError = 'Scratch cleanup target escaped the temporary root.'
        report.passed = false
        process.exitCode = 1
    }
    report.cleanup = { removed: !existsSync(scratch) }
    report.finishedAt = new Date().toISOString()
    save()
}
