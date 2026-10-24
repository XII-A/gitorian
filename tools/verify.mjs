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
const runner = ['notion', 'onboarding'].includes(mode) ? 'connections' : mode
const onboardingMode = mode === 'onboarding'
const connectionMode = mode === 'connections' || mode === 'notion'
if (
    !['doctor', 'repository-import', 'connections', 'notion', 'onboarding'].includes(mode) ||
    process.argv.length !== 3
) {
    console.error(
        'Usage: pnpm verify doctor | pnpm verify repository-import | pnpm verify connections | pnpm verify notion (run pnpm build first)'
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
    const report = {
        feature: mode,
        command: `${onboardingMode && process.env.WEEKLY_J_VERIFY_ONBOARDING_INLINE === '1' ? 'WEEKLY_J_VERIFY_ONBOARDING_INLINE=1 ' : ''}${onboardingMode && process.env.WEEKLY_J_VERIFY_ONBOARDING_REDUCED === '1' ? 'WEEKLY_J_VERIFY_ONBOARDING_REDUCED=1 ' : ''}pnpm verify ${mode}`,
        build,
        scratch,
        output,
        passed: false
    }
    const env = {
        ...process.env,
        WEEKLY_J_VERIFY_ONBOARDING: onboardingMode ? '1' : '0',
        WEEKLY_J_VERIFY_STATE: scratch,
        WEEKLY_J_VERIFY_OUTPUT: output,
        WEEKLY_J_VERIFY_SERVICE: mode === 'notion' ? 'notion' : ''
    }
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
                [
                    'diff',
                    '--binary',
                    'HEAD',
                    '--',
                    'src',
                    'services',
                    'tools',
                    'tests',
                    'package.json',
                    'pnpm-lock.yaml',
                    'pnpm-workspace.yaml',
                    'electron.vite.config.ts',
                    'tsconfig.json',
                    'netlify.toml'
                ],
                {
                    cwd: root,
                    windowsHide: true
                }
            )
        )
        if (onboardingMode)
            writeFileSync(
                join(output, 'onboarding-journey.mjs'),
                readFileSync(join(root, 'tools/onboarding-journey.mjs'))
            )
        for (const file of [
            'src/renderer/GettingStarted.tsx',
            'src/renderer/use-onboarding.ts',
            'src/renderer/components/arc/onboarding-checklist/onboarding-checklist.tsx',
            'src/renderer/components/arc/onboarding-checklist/onboarding-checklist.module.css'
        ]) {
            const target = join(output, 'source-files', file)
            mkdirSync(dirname(target), { recursive: true })
            writeFileSync(target, readFileSync(join(root, file)))
        }
        writeFileSync(join(output, 'verify-runner.mjs'), readFileSync(fileURLToPath(import.meta.url)))
        writeFileSync(join(output, `${mode}-smoke.mjs`), readFileSync(join(root, `tools/${runner}-smoke.mjs`)))
        for (const log of ['stdout.log', 'stderr.log']) writeFileSync(join(output, log), '')
        const result = await new Promise((done, reject) => {
            const child = spawn(electron, [`tools/${runner}-smoke.mjs`], {
                cwd: root,
                env,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            })
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
        const db = new DatabaseSync(join(scratch, 'profile', 'weekly-j.sqlite'), { readOnly: true })
        try {
            if (onboardingMode) {
                const repositories = db
                    .prepare("SELECT json FROM state_records WHERE collection='repositories'")
                    .all()
                    .map((row) => JSON.parse(String(row.json)))
                writeFileSync(join(output, 'persisted-repositories.json'), JSON.stringify(repositories, null, 2))
                if (repositories.length !== 1 || repositories[0].name !== 'journal-project' || repositories[0].removed)
                    throw new Error('Onboarding import was not persisted')
                const preferences = JSON.parse(readFileSync(join(output, 'preferences.json'), 'utf8'))
                if (preferences['weekly-j:onboarding:v1:local'] !== 'complete')
                    throw new Error('Completion preference was not retained')
            } else if (connectionMode) {
                const row = db.prepare("SELECT json FROM state_parts WHERE key='settings'").get()
                const settings = JSON.parse(String(row?.json))
                writeFileSync(join(output, 'persisted-settings.json'), JSON.stringify(settings, null, 2))
                if (
                    'githubClientId' in settings ||
                    settings.destination?.id !== 'fixture-private-journal' ||
                    settings.destination?.kind !== 'page' ||
                    settings.githubLogin !==
                        (mode === 'notion'
                            ? ''
                            : process.env.WEEKLY_J_VERIFY_MOTION === 'stress'
                              ? 'weekly-j-fixture-with-a-long-github-name'
                              : 'weekly-j-fixture')
                )
                    throw new Error('Persisted account settings differ from the authorized identity')
            } else {
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
            }
        } finally {
            db.close()
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
            onboardingMode
                ? [
                      'doctor.json',
                      'actions.jsonl',
                      '01-first-launch.png',
                      '01c-collapsed.png',
                      '01e-dismiss-tooltip.png',
                      'header-actions.json',
                      process.env.WEEKLY_J_VERIFY_ONBOARDING_INLINE === '1'
                          ? 'completion-motion.json'
                          : 'dismiss-motion.json',
                      process.env.WEEKLY_J_VERIFY_ONBOARDING_INLINE === '1'
                          ? '05-inline-setup.png'
                          : '05-resume-popover.png',
                      '09-complete-stats.png',
                      'preferences.json',
                      'persisted-repositories.json'
                  ]
                : mode === 'notion'
                  ? [
                        'doctor.json',
                        'actions.jsonl',
                        'http-requests.json',
                        'persisted-settings.json',
                        'notion-01-ready.png',
                        'notion-07-connected.png',
                        'notion-09-disconnected.png',
                        'notion-provisioned.json',
                        'captures.json'
                    ]
                  : mode === 'connections'
                    ? [
                          'doctor.json',
                          'actions.jsonl',
                          '01-idle.png',
                          '05-narrow-dark-code.png',
                          '08-disconnected.png',
                          'http-requests.json',
                          'persisted-settings.json',
                          'notion-04-failed.png',
                          'notion-07-connected.png',
                          'notion-09-disconnected.png',
                          'notion-provisioned.json',
                          'captures.json'
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
