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
const runner =
    mode === 'activity-filters'
        ? 'activity-filter'
        : ['notion', 'onboarding', 'onboarding-disclosure'].includes(mode)
          ? 'connections'
          : mode === 'inspector-tabs'
            ? 'desktop'
            : mode
const disclosureMode = mode === 'onboarding-disclosure'
const onboardingMode = mode === 'onboarding' || disclosureMode
const connectionMode = mode === 'connections' || mode === 'notion'
if (
    ![
        'doctor',
        'repository-import',
        'connections',
        'notion',
        'onboarding',
        'onboarding-disclosure',
        'inspector-tabs',
        'line-statistics',
        'window-chrome',
        'publishing',
        'activity-counts',
        'hub-dialog',
        'app-updates',
        'github-import',
        'activity-filters'
    ].includes(mode) ||
    process.argv.length !== 3
) {
    console.error(
        'Usage: pnpm verify doctor | repository-import | connections | notion | onboarding | onboarding-disclosure | inspector-tabs | line-statistics | window-chrome | activity-counts | publishing | hub-dialog | app-updates | github-import | activity-filters (run pnpm build first)'
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
    const scratch = mkdtempSync(join(tmpdir(), 'gitorian-import-'))
    const report = {
        feature: mode,
        command: `${onboardingMode && process.env.GITORIAN_VERIFY_ONBOARDING_INLINE === '1' ? 'GITORIAN_VERIFY_ONBOARDING_INLINE=1 ' : ''}${onboardingMode && process.env.GITORIAN_VERIFY_ONBOARDING_REDUCED === '1' ? 'GITORIAN_VERIFY_ONBOARDING_REDUCED=1 ' : ''}pnpm verify ${mode}`,
        build,
        scratch,
        output,
        passed: false
    }
    const env = {
        ...process.env,
        GITORIAN_VERIFY_ONBOARDING: onboardingMode ? '1' : '0',
        GITORIAN_VERIFY_ONBOARDING_DISCLOSURE: disclosureMode ? '1' : '0',
        GITORIAN_VERIFY_STATE: scratch,
        GITORIAN_VERIFY_OUTPUT: output,
        GITORIAN_VERIFY_SERVICE: mode === 'notion' ? 'notion' : ''
    }
    // The Codex host exports this flag for itself; Electron must launch as a desktop app.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    if (mode === 'inspector-tabs') env.INSPECTOR_TABS_ONLY = '1'
    writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2))
    console.info(`Evidence: ${output}`)
    let cleanupError
    try {
        if (mode === 'line-statistics')
            execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/line-statistics-fixture.ts'], {
                cwd: root,
                env,
                windowsHide: true
            })
        if (mode === 'inspector-tabs') writeFileSync(join(output, 'doctor.json'), JSON.stringify(build, null, 2))
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
        if (onboardingMode)
            writeFileSync(
                join(output, 'onboarding-disclosure-journey.mjs'),
                readFileSync(join(root, 'tools/onboarding-disclosure-journey.mjs'))
            )
        for (const file of [
            'src/renderer/GettingStarted.tsx',
            'src/renderer/OnboardingActivityPreview.tsx',
            'src/renderer/OnboardingSetupLayout.tsx',
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
        if (mode === 'line-statistics') {
            const db = new DatabaseSync(join(scratch, 'profile', 'gitorian.sqlite'), { readOnly: true })
            try {
                const activities = db
                    .prepare("SELECT json FROM state_records WHERE collection='activities'")
                    .all()
                    .map((row) => JSON.parse(String(row.json)))
                writeFileSync(join(output, 'persisted-activities.json'), JSON.stringify(activities, null, 2))
                const fixture = JSON.parse(readFileSync(join(output, 'fixture.json'), 'utf8'))
                const inspected = activities.filter((activity) =>
                    [fixture.commitId, fixture.prId].includes(activity.id)
                )
                for (const activity of inspected) {
                    const stats = activity.files.map((file) => file.lineStats).filter(Boolean)
                    if (
                        !activity.filesLoaded ||
                        activity.files.some((file) => file.lineStats === undefined) ||
                        stats.reduce((sum, item) => Number(sum) + Number(item.additions), 0) !== 647 ||
                        stats.reduce((sum, item) => Number(sum) + Number(item.deletions), 0) !== 45
                    )
                        throw new Error('Persisted line statistics differ from the fixture')
                }
                if (inspected.length !== 2) throw new Error('Expected commit and PR metadata to persist')
            } finally {
                db.close()
            }
        }
        if (mode === 'github-import') {
            const db = new DatabaseSync(join(scratch, 'profile', 'gitorian.sqlite'), { readOnly: true })
            try {
                const records = (collection) =>
                    db
                        .prepare('SELECT json FROM state_records WHERE collection=?')
                        .all(collection)
                        .map((row) => JSON.parse(String(row.json)))
                const repositories = records('repositories')
                const activities = records('activities')
                const settings = JSON.parse(
                    String(db.prepare("SELECT json FROM state_parts WHERE key='settings'").get()?.json)
                )
                writeFileSync(
                    join(output, 'persisted-github-activity.json'),
                    JSON.stringify({ repositories, activities, refreshMinutes: settings.refreshMinutes }, null, 2)
                )
                if (
                    repositories.length !== 2 ||
                    repositories.find((repo) => repo.name === 'before')?.remote !==
                        'https://github.com/fixture/before.git' ||
                    repositories.find((repo) => repo.name === 'after')?.remote !== '' ||
                    settings.refreshMinutes !== 0 ||
                    activities.filter((a) => a.kind === 'pr').length !== 2 ||
                    activities.filter((a) => a.kind === 'review').length !== 2 ||
                    activities.filter((a) => a.kind === 'commit' && a.title.startsWith('Local work')).length !== 2
                )
                    throw new Error('Imported sources and GitHub activity were not persisted')
            } finally {
                db.close()
            }
        }
        if (mode === 'publishing') {
            const db = new DatabaseSync(join(scratch, 'profile', 'gitorian.sqlite'), { readOnly: true })
            try {
                const entries = db
                    .prepare("SELECT json FROM state_records WHERE collection='entries'")
                    .all()
                    .map((row) => JSON.parse(String(row.json)))
                writeFileSync(join(output, 'persisted-entries.json'), JSON.stringify(entries, null, 2))
                if (
                    entries.length !== 1 ||
                    entries[0].id !== 'fixture-entry' ||
                    !JSON.stringify(entries[0].body).includes('Followed up')
                )
                    throw new Error('Updated writing was not persisted')
            } finally {
                db.close()
            }
        }
        if (mode === 'app-updates') {
            const db = new DatabaseSync(join(scratch, 'profile', 'gitorian.sqlite'), { readOnly: true })
            try {
                const drafts = db
                    .prepare("SELECT json FROM state_records WHERE collection='drafts'")
                    .all()
                    .map((row) => JSON.parse(String(row.json)))
                writeFileSync(join(output, 'persisted-drafts.json'), JSON.stringify(drafts, null, 2))
                if (drafts.length !== 1 || !JSON.stringify(drafts).includes('Final keystroke before updating.'))
                    throw new Error('Final writing did not survive update shutdown')
            } finally {
                db.close()
            }
        }
        if (
            mode !== 'line-statistics' &&
            mode !== 'inspector-tabs' &&
            mode !== 'window-chrome' &&
            mode !== 'publishing' &&
            mode !== 'activity-counts' &&
            mode !== 'hub-dialog' &&
            mode !== 'app-updates' &&
            mode !== 'github-import' &&
            mode !== 'activity-filters'
        ) {
            const db = new DatabaseSync(join(scratch, 'profile', 'gitorian.sqlite'), { readOnly: true })
            try {
                if (disclosureMode) {
                    const count = db
                        .prepare("SELECT count(*) AS total FROM state_records WHERE collection='repositories'")
                        .get()
                    if (count.total !== 0) throw new Error('Disclosure fixture unexpectedly imported repositories')
                } else if (onboardingMode) {
                    const repositories = db
                        .prepare("SELECT json FROM state_records WHERE collection='repositories'")
                        .all()
                        .map((row) => JSON.parse(String(row.json)))
                    writeFileSync(join(output, 'persisted-repositories.json'), JSON.stringify(repositories, null, 2))
                    if (
                        repositories.length !== 1 ||
                        repositories[0].name !== 'journal-project' ||
                        repositories[0].removed
                    )
                        throw new Error('Onboarding import was not persisted')
                    const preferences = JSON.parse(readFileSync(join(output, 'preferences.json'), 'utf8'))
                    if (preferences['gitorian:onboarding:v1:local'] !== 'complete')
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
                                : process.env.GITORIAN_VERIFY_MOTION === 'stress'
                                  ? 'gitorian-fixture-with-a-long-github-name'
                                  : 'gitorian-fixture')
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
        }
        report.passed = true
    } catch (error) {
        report.error = String(error)
    } finally {
        const target = resolve(scratch)
        try {
            if (
                dirname(target) === resolve(tmpdir()) &&
                target.startsWith(resolve(tmpdir()) + sep + 'gitorian-import-')
            )
                rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
            else cleanupError = `Refusing cleanup outside the owned scratch directory: ${target}`
        } catch (error) {
            cleanupError = String(error)
        }
        report.cleanup = { removed: !existsSync(scratch), error: cleanupError }
        report.evidenceRetained = (
            mode === 'app-updates'
                ? [
                      'actions.jsonl',
                      '05-update-ready-toast.png',
                      '06-update-popover.png',
                      '06-hub-update-popover.png',
                      'writing-performance.json',
                      'installer-handoff.json',
                      'persisted-drafts.json',
                      'journey.json'
                  ]
                : mode === 'activity-counts' || mode === 'github-import' || mode === 'activity-filters'
                  ? [
                        'actions.jsonl',
                        mode === 'activity-counts'
                            ? 'activity-counts.png'
                            : mode === 'github-import'
                              ? 'automatic-prs.png'
                              : 'grouped-filters.png',
                        'journey.json',
                        ...(mode === 'github-import'
                            ? [
                                  'connected-with-activity.png',
                                  'source-failure.png',
                                  'persisted-prs.png',
                                  'persisted-github-activity.json',
                                  'http-requests.json'
                              ]
                            : [])
                    ]
                  : mode === 'hub-dialog'
                    ? [
                          'actions.jsonl',
                          'hub-before-windowed.png',
                          'hub-dialog-windowed.png',
                          'hub-dialog-maximized.png',
                          'hub-dialog-restored.png',
                          'journey.json'
                      ]
                    : mode === 'publishing'
                      ? [
                            'actions.jsonl',
                            'published-to-notion.png',
                            'updated-in-notion.png',
                            'publish-failed.png',
                            'persisted-entries.json',
                            'http-requests.json',
                            'journey.json'
                        ]
                      : mode === 'window-chrome'
                        ? [
                              'actions.jsonl',
                              '01-frame-hidden.png',
                              '02-controls-revealed.png',
                              '03-reduced-motion.png',
                              '04-reference-frame-dark.png',
                              '04-reference-frame-light.png'
                          ]
                        : mode === 'line-statistics'
                          ? [
                                'doctor.json',
                                'actions.jsonl',
                                'hub-commit-breakdown.png',
                                'hub-pr-breakdown.png',
                                'workspace-details.png',
                                'selected-file-diff.png',
                                'persisted-activities.json',
                                'journey.json'
                            ]
                          : mode === 'inspector-tabs'
                            ? [
                                  'doctor.json',
                                  'actions.json',
                                  'docked-dark-details.png',
                                  'reference-dark-details.png',
                                  'reference-light-related.png',
                                  'journey.json'
                              ]
                            : disclosureMode
                              ? [
                                    'doctor.json',
                                    'actions.jsonl',
                                    'disclosure-motion.json',
                                    'disclosure.png',
                                    'journey.json'
                                ]
                              : onboardingMode
                                ? [
                                      'doctor.json',
                                      'actions.jsonl',
                                      '01-first-launch.png',
                                      '01c-collapsed.png',
                                      '01e-dismiss-tooltip.png',
                                      'header-actions.json',
                                      'header-geometry.json',
                                      process.env.GITORIAN_VERIFY_ONBOARDING_INLINE === '1'
                                          ? 'completion-motion.json'
                                          : 'dismiss-motion.json',
                                      process.env.GITORIAN_VERIFY_ONBOARDING_INLINE === '1'
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
