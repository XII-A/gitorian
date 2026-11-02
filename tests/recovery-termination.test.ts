import { spawn } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { terminateDesktop } from '../src/main/recovery-termination'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it.skipIf(process.platform !== 'win32')(
    'preserves the watchdog branch while terminating its blocked parent',
    async () => {
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
            await vi.waitFor(async () => expect(await readFile(proof, 'utf8')).toBe('watch-survived'), {
                timeout: 3000
            })
        } finally {
            if (desktop.exitCode === null) desktop.kill()
            await rm(directory, { recursive: true, force: true })
        }
    },
    20000
)

it.skipIf(process.platform !== 'win32')(
    'force restart waits for the exact owned desktop tree to exit',
    async () => {
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
            expect(descendant).toBeGreaterThan(0)
            const exited = new Promise<void>((resolve) => desktop.once('exit', () => resolve()))
            await terminateDesktop(
                desktop.pid!,
                () => desktop.exitCode === null,
                () => undefined
            )
            await exited
            expect(desktop.exitCode).not.toBeNull()
            expect(() => process.kill(descendant, 0)).toThrow()
        } finally {
            if (desktop.exitCode === null) desktop.kill()
        }
    },
    20000
)
