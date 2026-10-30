import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const version = '3.22.4'
const commit = '5e8c4fe9e82fecdddb7812fa0090470b15a6fea0'
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = fileURLToPath(new URL('../.reference/effect', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.dependencies.effect !== version)
    throw new Error('Update the Effect reference pin for this dependency version.')

function git(args, cwd = root) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

mkdirSync(new URL('../.reference/', import.meta.url), { recursive: true })
if (!existsSync(destination)) {
    git([
        'clone',
        '--depth',
        '1',
        '--branch',
        `effect@${version}`,
        'https://github.com/Effect-TS/effect.git',
        destination
    ])
}
if (git(['rev-parse', 'HEAD'], destination) !== commit) {
    throw new Error(`Effect reference must be at ${commit}. Existing checkout was left untouched.`)
}
if (git(['status', '--porcelain'], destination))
    throw new Error('Effect reference has local changes; inspect them before use.')
console.info(`Effect ${version} reference verified at ${destination} (${commit})`)
