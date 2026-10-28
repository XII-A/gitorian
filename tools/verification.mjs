import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [mode, ...args] = process.argv.slice(2)
if (!['build', 'compile', 'desktop', 'release'].includes(mode) || (mode !== 'desktop' && args.length)) {
    console.error('Use pnpm build | build:compile | test:e2e [Playwright arguments] | verify:release')
    process.exit(1)
}
const pnpm = process.env.npm_execpath
if (!pnpm || !existsSync(pnpm)) {
    console.error('Run verification through the pnpm package scripts.')
    process.exit(1)
}
const evidence = join(root, '.ai-docs', 'verification')
mkdirSync(evidence, { recursive: true })
const lock = join(evidence, 'checkout.lock')
try {
    mkdirSync(lock)
} catch (error) {
    if (error.code !== 'EEXIST') throw error
    let owner = 'Owner metadata unavailable'
    try {
        owner = readFileSync(join(lock, 'owner.json'), 'utf8')
    } catch {
        /* interrupted acquisition */
    }
    console.error(
        `Verification is already running: ${owner}\nLock: ${lock}\nAfter verifying the owner and its children have exited, remove this exact lock directory and retry.`
    )
    process.exit(1)
}

let active
let interrupted = false
let retainLock = false
const report = {
    mode,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    source: undefined,
    stages: [],
    passed: false,
    error: ''
}
let output
const save = () => {
    if (output) writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
}
function sourceIdentity() {
    const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
    const commit = git('rev-parse', 'HEAD').toString().trim()
    const hash = createHash('sha256').update(commit)
    const files = [
        ...new Set(
            git('ls-files', '--cached', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean)
        )
    ].sort()
    for (const file of files) {
        hash.update(file).update('\0')
        try {
            const path = join(root, file)
            const stat = lstatSync(path)
            hash.update(String(stat.mode)).update('\0')
            hash.update(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))
        } catch (error) {
            if (error.code !== 'ENOENT') throw error
            hash.update('<missing>')
        }
        hash.update('\0')
    }
    return { commit, hash: hash.digest('hex') }
}
function interrupt() {
    interrupted = true
    if (!active?.pid) return
    try {
        if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(active.pid), '/T', '/F'], {
                windowsHide: true,
                timeout: 5000,
                stdio: 'ignore'
            })
        else process.kill(-active.pid, 'SIGTERM')
    } catch {
        // A lock is safer than allowing another build while descendants may survive.
        retainLock = true
        active.kill()
    }
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

async function run(command) {
    if (interrupted) throw new Error('Verification interrupted')
    const stage = {
        command: ['pnpm', ...command].join(' '),
        startedAt: new Date().toISOString(),
        code: null,
        signal: null
    }
    report.stages.push(stage)
    save()
    try {
        const result = await new Promise((resolve, reject) => {
            active = spawn(process.execPath, [pnpm, ...command], {
                cwd: root,
                stdio: 'inherit',
                env: mode === 'release' ? { ...process.env, CI: '1' } : process.env,
                windowsHide: true,
                detached: process.platform !== 'win32'
            })
            active.once('error', reject)
            active.once('close', (code, signal) => resolve({ code, signal }))
        })
        Object.assign(stage, result)
        if (interrupted || result.code !== 0)
            throw new Error(`${stage.command} failed (exit ${result.code}, signal ${result.signal})`)
        if (mode === 'release' && sourceIdentity().hash !== report.source.hash)
            throw new Error('Source changed during verification; rerun on the final revision.')
    } finally {
        active = undefined
        stage.finishedAt = new Date().toISOString()
        save()
    }
}
try {
    writeFileSync(
        join(lock, 'owner.json'),
        JSON.stringify({ pid: process.pid, command: mode, startedAt: report.startedAt })
    )
    if (mode === 'release') {
        output = join(evidence, 'release', `${Date.now()}-${randomUUID().slice(0, 8)}`)
        mkdirSync(output, { recursive: true })
        report.source = sourceIdentity()
        console.info(`Release verification evidence: ${output}`)
        save()
    }
    if (mode === 'release') await run(['check'])
    if (mode === 'build') await run(['typecheck'])
    if (['build', 'compile', 'release'].includes(mode)) {
        await run(['exec', 'electron-vite', 'build'])
        await run(['--filter', '@gitorian/notion-oauth', 'build'])
    }
    if (['desktop', 'release'].includes(mode)) await run(['exec', 'playwright', 'test', ...args])
    report.passed = true
} catch (error) {
    report.error = String(error)
    console.error(report.error)
    process.exitCode = 1
} finally {
    report.finishedAt = new Date().toISOString()
    if (retainLock) {
        report.passed = false
        report.error += `\nProcess cleanup incomplete. Inspect ownership at ${lock}`
        process.exitCode = 1
    } else {
        try {
            rmSync(lock, { recursive: true })
        } catch (error) {
            report.passed = false
            report.error += `\nLock cleanup failed: ${error}`
            process.exitCode = 1
        }
    }
    save()
}
