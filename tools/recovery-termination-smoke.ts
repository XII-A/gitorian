import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateDesktop } from '../src/main/recovery-termination'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdtemp, readFile, rm, watch } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function verifyWatchdogSurvives() {
    const modulePath = pathToFileURL(resolve('src/main/recovery-termination.ts')).href
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-watch-owner-'))
    const proof = join(directory, 'proof.txt')
    const owner = `import {writeFileSync} from 'node:fs';import {terminateDesktop} from ${JSON.stringify(modulePath)};try{await terminateDesktop(Number(process.argv[1]),()=>true,()=>{});writeFileSync(${JSON.stringify(proof)},'watch-survived')}catch(e){writeFileSync(${JSON.stringify(proof)},String(e));process.exitCode=1}`
    const script = `const{spawn}=require('node:child_process');spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(owner)},String(process.pid)],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)`
    const desktop = spawn(process.execPath, ['-e', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    })
    try {
        await new Promise<void>((resolve, reject) => {
            desktop.once('close', (code) => (code === null ? reject(new Error('Missing native exit')) : resolve()))
        })
        const changes = watch(directory, { signal: AbortSignal.timeout(3000) })
        if (!existsSync(proof)) {
            for await (const change of changes) {
                if (change.filename === 'proof.txt' && existsSync(proof)) break
            }
        }
        assert.equal(await readFile(proof, 'utf8'), 'watch-survived')
    } finally {
        if (desktop.exitCode === null) desktop.kill()
        await rm(directory, { recursive: true, force: true })
    }
}

async function verifyDesktopTreeExits() {
    const desktop = spawn(
        process.execPath,
        [
            '-e',
            `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)`
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    try {
        const descendant = await new Promise<number>((resolve) =>
            desktop.stdout.once('data', (data: Buffer) => resolve(Number(data.toString().trim())))
        )
        assert.ok(descendant > 0)
        const exited = new Promise<void>((resolve) => desktop.once('exit', () => resolve()))
        await terminateDesktop(
            desktop.pid!,
            () => desktop.exitCode === null,
            () => undefined
        )
        await exited
        assert.notEqual(desktop.exitCode, null)
        assert.throws(() => process.kill(descendant, 0))
    } finally {
        if (desktop.exitCode === null) desktop.kill()
    }
}

if (process.platform === 'win32') {
    await verifyWatchdogSurvives()
    await verifyDesktopTreeExits()
    console.info('Windows recovery termination checks passed.')
}
