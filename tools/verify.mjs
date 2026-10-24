import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electron = require('electron')
const mode = process.argv[2]
if (!['doctor', 'repository-import', 'window-chrome'].includes(mode) || process.argv.length !== 3) {
    console.error(
        'Usage: pnpm verify doctor | pnpm verify repository-import | pnpm verify window-chrome (run pnpm build first)'
    )
    process.exit(1)
}

function doctor() {
    const files = ['out/main/index.js', 'out/main/store-writer.js', 'out/preload/index.cjs', 'out/renderer/index.html']
    const hashes = Object.fromEntries(
        files.map((file) => [
            file,
            createHash('sha256')
                .update(readFileSync(join(root, file)))
                .digest('hex')
        ])
    )
    if (!existsSync(electron)) throw new Error('Electron is missing; run pnpm install --frozen-lockfile')
    return {
        root,
        node: process.version,
        version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
        changes: execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
        hashes
    }
}

if (mode === 'doctor') {
    console.info(JSON.stringify(doctor(), null, 2))
} else {
    const build = doctor()
    const evidenceRoot = join(root, '.ai-docs', 'verification')
    mkdirSync(evidenceRoot, { recursive: true })
    const output = mkdtempSync(join(evidenceRoot, `${mode}-`))
    const scratch = mkdtempSync(join(tmpdir(), 'weekly-j-import-'))
    const report = { feature: mode, command: `pnpm verify ${mode}`, build, scratch, output, passed: false }
    const env = { ...process.env, WEEKLY_J_VERIFY_STATE: scratch, WEEKLY_J_VERIFY_OUTPUT: output }
    // The Codex host exports this flag for itself; Electron must launch as a desktop app.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
    console.info(`Evidence: ${output}`)
    let cleanupError
    try {
        writeFileSync(
            join(output, 'source.patch'),
            execFileSync(
                'git',
                ['diff', '--binary', 'HEAD', '--', 'src', 'tools', 'package.json', 'electron.vite.config.ts'],
                {
                    cwd: root,
                    windowsHide: true
                }
            )
        )
        writeFileSync(join(output, 'verify-runner.mjs'), readFileSync(fileURLToPath(import.meta.url)))
        for (const log of ['stdout.log', 'stderr.log']) writeFileSync(join(output, log), '')
        const result = await new Promise((done, reject) => {
            const child = spawn(
                electron,
                [`tools/${mode === 'window-chrome' ? 'window-chrome' : 'repository-import'}-smoke.mjs`],
                {
                    cwd: root,
                    env,
                    windowsHide: true,
                    stdio: ['ignore', 'pipe', 'pipe']
                }
            )
            report.pid = child.pid
            writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
            child.stdout.on('data', (data) => appendFileSync(join(output, 'stdout.log'), data))
            child.stderr.on('data', (data) => appendFileSync(join(output, 'stderr.log'), data))
            const timer = setTimeout(() => {
                report.timedOut = true
                try {
                    if (process.platform === 'win32')
                        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
                    else child.kill('SIGKILL')
                } catch (error) {
                    report.terminationError = String(error)
                    child.kill('SIGKILL')
                }
            }, 90000)
            child.once('error', (error) => {
                clearTimeout(timer)
                reject(new Error(String(error)))
            })
            child.once('close', (code, signal) => {
                clearTimeout(timer)
                done({ code, signal })
            })
        })
        report.exit = result
        if (result.code !== 0 || report.timedOut) throw new Error(`Electron journey failed: ${JSON.stringify(result)}`)
        const journey = JSON.parse(readFileSync(join(output, 'journey.json'), 'utf8'))
        if (!journey.passed) throw new Error('The journey did not report success')
        if (mode === 'repository-import') {
            const db = new DatabaseSync(join(scratch, 'profile', 'weekly-j.sqlite'), { readOnly: true })
            try {
                const repositories = db
                    .prepare("SELECT json FROM state_records WHERE collection='repositories'")
                    .all()
                    .map((row) => JSON.parse(String(row.json)))
                writeFileSync(join(output, 'persisted-repositories.json'), JSON.stringify(repositories, null, 2))
                const expected = ['api-server', 'archived-tools', 'design-system', 'website', 'website'].sort()
                if (
                    JSON.stringify(repositories.map((item) => item.name).sort()) !== JSON.stringify(expected) ||
                    repositories.some((item) => item.removed)
                )
                    throw new Error('Persisted import differs from the selected repositories')
            } finally {
                db.close()
            }
        }
        report.passed = true
    } catch (error) {
        report.error = String(error)
    } finally {
        const target = resolve(scratch)
        try {
            if (
                dirname(target) === resolve(tmpdir()) &&
                target.startsWith(resolve(tmpdir()) + sep + 'weekly-j-import-')
            )
                rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
            else cleanupError = `Refusing cleanup outside the owned scratch directory: ${target}`
        } catch (error) {
            cleanupError = String(error)
        }
        report.cleanup = { removed: !existsSync(scratch), error: cleanupError }
        report.evidenceRetained = (
            mode === 'window-chrome'
                ? [
                      'actions.jsonl',
                      '01-frame-hidden.png',
                      '02-controls-revealed.png',
                      '03-reduced-motion.png',
                      '04-reference-frame-dark.png',
                      '04-reference-frame-light.png'
                  ]
                : [
                      'doctor.json',
                      'actions.jsonl',
                      '01-choose-folder.png',
                      '08-complete.png',
                      '10-error-details.png',
                      'persisted-repositories.json'
                  ]
        ).every((file) => existsSync(join(output, file)))
        report.passed &&= report.cleanup.removed && report.evidenceRetained
        report.finishedAt = new Date().toISOString()
        writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
    }
    console.info(JSON.stringify(report, null, 2))
    process.exitCode = report.passed ? 0 : 1
}
