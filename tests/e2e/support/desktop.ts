import { _electron, test as base, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

interface Desktop {
    app: ElectronApplication
    page: Page
    scratch: string
    profile: string
    chooseFolder: (path: string, delay?: number) => Promise<void>
    shot: (name: string) => Promise<void>
    close: () => Promise<void>
}

export const test = base.extend<{ desktop: Desktop; desktopEntry: string }>({
    desktopEntry: ['out/main/index.js', { option: true }],
    desktop: async ({ desktopEntry }, use, info) => {
        mkdirSync(info.outputDir, { recursive: true })
        const scratch = mkdtempSync(join(tmpdir(), 'gitorian-e2e-'))
        const profile = join(scratch, 'profile')
        const report = {
            command: `pnpm test:e2e ${JSON.stringify(relative(resolve('.'), info.file).split(sep).join('/'))}`,
            title: info.title,
            scratch,
            profile,
            output: info.outputDir,
            build: {},
            pid: undefined as number | undefined,
            exit: undefined as number | null | undefined,
            passed: false,
            cleanup: { removed: false },
            evidenceRetained: false,
            error: ''
        }
        const save = () => writeFileSync(info.outputPath('run.json'), JSON.stringify(report, null, 2))
        save()
        console.info(`Evidence: ${info.outputDir}`)
        let app: ElectronApplication | undefined
        let page: Page | undefined
        let closed = false
        let tracing = false
        let shutdownError: Error | undefined
        const close = async () => {
            if (!app || closed) return
            let traceError: unknown
            if (tracing) {
                try {
                    await app.context().tracing.stop({ path: info.outputPath('trace.zip') })
                } catch (error) {
                    traceError = error
                }
                tracing = false
            }
            const child = app.process()
            const timer = setTimeout(() => {
                if (child.exitCode !== null || !child.pid) return
                try {
                    if (process.platform === 'win32')
                        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
                    else child.kill('SIGKILL')
                } catch (error) {
                    report.error += `\nProcess termination: ${String(error)}`
                    child.kill('SIGKILL')
                }
            }, 10_000)
            try {
                await app.close()
                report.exit = child.exitCode
                expect(report.exit, 'Electron must exit cleanly').toBe(0)
                if (traceError) throw new Error('Cannot save Electron trace', { cause: traceError })
            } finally {
                clearTimeout(timer)
                closed = child.exitCode !== null || child.signalCode !== null
            }
        }
        try {
            report.build = JSON.parse(
                execFileSync(process.execPath, ['tools/verify.mjs', 'doctor'], {
                    cwd: resolve('.'),
                    encoding: 'utf8',
                    windowsHide: true
                })
            )
            writeFileSync(
                info.outputPath('source.patch'),
                execFileSync('git', ['diff', '--binary', 'HEAD'], { windowsHide: true })
            )
            const env: Record<string, string> = { GITORIAN_E2E_PROFILE: profile, GITORIAN_DEV_PROFILE: profile }
            for (const [key, value] of Object.entries(process.env))
                if (value !== undefined && !(key in env)) env[key] = value
            delete env.ELECTRON_RUN_AS_NODE
            delete env.ELECTRON_RENDERER_URL
            app = await _electron.launch({ args: [desktopEntry], env, timeout: 30_000 })
            report.pid = app.process().pid
            save()
            for (const [stream, file] of [
                [app.process().stdout, 'stdout.log'],
                [app.process().stderr, 'stderr.log']
            ] as const) {
                writeFileSync(info.outputPath(file), '')
                stream?.on('data', (data: Buffer) => appendFileSync(info.outputPath(file), data))
            }
            await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
            tracing = true
            page = await app.firstWindow()
            await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
            const doctor = {
                url: page.url(),
                profile: await app.evaluate(({ app }) => app.getPath('userData')),
                title: await page.title(),
                state: await page.evaluate(() => window.journal.invoke({ type: 'state' }))
            }
            writeFileSync(info.outputPath('doctor.json'), JSON.stringify(doctor, null, 2))
            expect(doctor.profile).toBe(profile)
            expect(doctor.url).toBe(pathToFileURL(resolve('out/renderer/index.html')).href)
            expect(doctor.title).toBe('Gitorian')
            expect(doctor.state.state.repositories).toEqual([])
            expect(doctor.state.connections.github).toBe(false)
            expect(doctor.state.connections.notion).toBe(false)
            await use({
                app,
                page,
                scratch,
                profile,
                close,
                chooseFolder: async (path, delay = 0) => {
                    await app!.evaluate(
                        ({ dialog }, choice) => {
                            dialog.showOpenDialog = async () => {
                                await new Promise((done) => setTimeout(done, choice.delay))
                                return { canceled: false, filePaths: [choice.path] }
                            }
                        },
                        { path, delay }
                    )
                },
                shot: async (name) => {
                    const path = info.outputPath(`${name}.png`)
                    await page!.screenshot({ path })
                    await info.attach(name, { path, contentType: 'image/png' })
                }
            })
            report.passed = info.status === info.expectedStatus
        } catch (error) {
            report.error = String(error)
            throw error
        } finally {
            try {
                if (page && !page.isClosed() && info.status !== info.expectedStatus)
                    await page
                        .screenshot({ path: info.outputPath('failure.png'), timeout: 5000 })
                        .catch((error: unknown) => {
                            report.error += `\nFailure screenshot: ${String(error)}`
                        })
                await close()
            } catch (error) {
                report.passed = false
                report.error += `\nShutdown: ${String(error)}`
                shutdownError = new Error('Desktop shutdown failed', { cause: error })
            } finally {
                // Only remove the exact directory created by this fixture, after its process exits.
                try {
                    if ((!app || closed) && dirname(scratch) === resolve(tmpdir()))
                        rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
                } catch (error) {
                    report.error += `\nProfile cleanup: ${String(error)}`
                }
                report.cleanup.removed = !existsSync(scratch)
                report.evidenceRetained = [
                    'doctor.json',
                    'trace.zip',
                    'source.patch',
                    'stdout.log',
                    'stderr.log'
                ].every((file) => existsSync(info.outputPath(file)))
                report.passed &&= report.cleanup.removed && report.exit === 0 && report.evidenceRetained
                save()
                for (const file of ['trace.zip', 'failure.png'])
                    if (existsSync(info.outputPath(file))) await info.attach(file, { path: info.outputPath(file) })
                await info.attach('desktop-run', { path: info.outputPath('run.json'), contentType: 'application/json' })
            }
        }
        if (shutdownError) throw shutdownError
        expect(report.cleanup.removed, `Owned profile was not removed: ${scratch}`).toBe(true)
        expect(report.evidenceRetained, 'Desktop evidence must survive cleanup').toBe(true)
    }
})

export { expect } from '@playwright/test'
