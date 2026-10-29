import { afterEach, expect, it } from 'vitest'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const fixtures: string[] = []
const processes: ChildProcess[] = []
afterEach(async () => {
    for (const child of processes.splice(0)) {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
        const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
        if (process.platform === 'win32')
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        else child.kill('SIGKILL')
        await closed
    }
    await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-verification-'))
    fixtures.push(root)
    await mkdir(join(root, 'tools'))
    await copyFile(resolve('tools/verification.mjs'), join(root, 'tools/verification.mjs'))
    await writeFile(join(root, 'source.txt'), 'original')
    await writeFile(join(root, '.gitignore'), '.ai-docs/\ncommands.txt\nwaiting\nrelease\n')
    execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true })
    execFileSync('git', ['add', 'source.txt'], { cwd: root, windowsHide: true })
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'],
        {
            cwd: root,
            windowsHide: true
        }
    )
    // A local process adapter: real child processes, with deterministic stage failure/gating.
    const pnpm = join(root, 'pnpm.cjs')
    await writeFile(
        pnpm,
        `
const fs = require('node:fs');
const args = process.argv.slice(2).join(' ');
fs.appendFileSync('commands.txt', args + '\\n');
if (process.env.HOLD_STAGE === args) {
    fs.writeFileSync('waiting', String(process.pid));
    const timer = setInterval(() => {
        if (fs.existsSync('release')) { clearInterval(timer); process.exit(0) }
    }, 20);
} else process.exit(process.env.FAIL_STAGE === args ? 7 : 0);
`
    )
    const start = (mode: string, env: Record<string, string> = {}) => {
        const child = spawn(process.execPath, ['tools/verification.mjs', mode], {
            cwd: root,
            env: {
                ...Object.fromEntries(
                    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath')
                ),
                npm_execpath: pnpm,
                ...env
            },
            windowsHide: true
        })
        processes.push(child)
        let output = ''
        child.stdout.on('data', (data: Buffer) => {
            output += data.toString('utf8')
        })
        child.stderr.on('data', (data: Buffer) => {
            output += data.toString('utf8')
        })
        const done = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
            child.once('error', reject)
            child.once('close', (code) => resolve({ code, output }))
        })
        return { child, done }
    }
    const commands = async () => (await readFile(join(root, 'commands.txt'), 'utf8')).trim().split('\n')
    const waiting = async () =>
        expect.poll(() => readFile(join(root, 'waiting'), 'utf8'), { timeout: 5000 }).toBeTruthy()
    return { root, start, commands, waiting, release: () => writeFile(join(root, 'release'), '') }
}

it('excludes a second desktop/build command until the first child exits', async () => {
    const f = await fixture()
    const first = f.start('compile', { HOLD_STAGE: 'exec electron-vite build' })
    try {
        await f.waiting()
        const second = await f.start('desktop').done
        expect(second.code).not.toBe(0)
        expect(second.output).toContain('Verification is already running')
        expect(await f.commands()).toEqual(['exec electron-vite build'])
    } finally {
        await f.release()
        const result = await first.done
        expect(result.code, result.output).toBe(0)
    }
    expect((await f.start('desktop').done).code).toBe(0)
})

it('records a complete successful release sequence and stops immediately on child failure', async () => {
    const f = await fixture()
    const passed = await f.start('release').done
    expect(passed.code, passed.output).toBe(0)
    expect(await f.commands()).toEqual([
        'check',
        'exec electron-vite build',
        '--filter @gitorian/notion-oauth build',
        'exec playwright test'
    ])
    const failed = await f.start('release', { FAIL_STAGE: 'check' }).done
    expect(failed.code).not.toBe(0)
    expect((await f.commands()).slice(4)).toEqual(['check'])
    const { readdir } = await import('node:fs/promises')
    const runs = await readdir(join(f.root, '.ai-docs/verification/release'))
    const reports = await Promise.all(
        runs.map(async (run) =>
            JSON.parse(await readFile(join(f.root, '.ai-docs/verification/release', run, 'run.json'), 'utf8'))
        )
    )
    expect(reports.filter((report) => report.passed)).toHaveLength(1)
    expect(reports.find((report) => report.passed).stages.every((stage: { code: number }) => stage.code === 0)).toBe(
        true
    )
    expect(reports.find((report) => !report.passed).stages).toHaveLength(1)
})

it.each(['source.txt', 'new-source.ts'])('rejects source changes during verification: %s', async (file) => {
    const f = await fixture()
    const run = f.start('release', { HOLD_STAGE: 'check' })
    try {
        await f.waiting()
        await writeFile(join(f.root, file), 'changed')
    } finally {
        await f.release()
    }
    const result = await run.done
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Source changed during verification')
    expect(await f.commands()).toEqual(['check'])
})

it('retains actionable ownership after a hard process-tree interruption', async () => {
    const f = await fixture()
    const run = f.start('compile', { HOLD_STAGE: 'exec electron-vite build' })
    await f.waiting()
    const childPid = Number(await readFile(join(f.root, 'waiting'), 'utf8'))
    if (process.platform === 'win32') {
        // Kill the owner first: /T may kill its child first and let the owner clean up
        // normally before taskkill reaches it, which does not simulate a hard interruption.
        execFileSync('taskkill', ['/PID', String(run.child.pid), '/F'], { windowsHide: true })
        try {
            execFileSync('taskkill', ['/PID', String(childPid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore'
            })
        } catch {
            // Closing the owner's pipes can already have terminated the child.
            expect(() => process.kill(childPid, 0)).toThrow()
        }
    } else {
        process.kill(childPid, 'SIGKILL')
        run.child.kill('SIGKILL')
    }
    await run.done
    const next = await f.start('desktop').done
    expect(next.code).not.toBe(0)
    expect(next.output).toContain('Verification is already running')
    expect(next.output).toContain('checkout.lock')
})
