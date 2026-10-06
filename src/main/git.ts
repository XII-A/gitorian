import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { Activity, Repository } from '../shared/model'

const execute = promisify(execFile)
const MAX_DIFF = 2_000_000
export async function git(path: string, args: string[]): Promise<string> {
    const result = await execute('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], {
        cwd: path,
        encoding: 'utf8',
        maxBuffer: 16_000_000,
        timeout: 30000,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }
    })
    return result.stdout
}
export async function inspectRepository(
    path: string
): Promise<{ name: string; remotes: string[]; base: string; email: string }> {
    await git(path, ['rev-parse', '--show-toplevel'])
    const remotes = (await git(path, ['remote', '-v']))
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => line.split(/\s+/)[1])
        .filter(Boolean)
    const refs = (await git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).trim().split('\n')
    let base = refs.includes('development')
        ? 'development'
        : refs.includes('main')
          ? 'main'
          : refs.includes('master')
            ? 'master'
            : refs[0] || 'main'
    try {
        base = (await git(path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))
            .trim()
            .replace(/^origin\//, '')
    } catch {
        /* A local-only repository has no origin HEAD. */
    }
    let email = ''
    try {
        email = (await git(path, ['config', 'user.email'])).trim()
    } catch {
        /* Identity can be configured in the app. */
    }
    return { name: basename(path), remotes: [...new Set(remotes)], base, email }
}
export async function branches(repository: Repository): Promise<string[]> {
    return (await git(repository.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']))
        .trim()
        .split('\n')
        .filter((name) => name && !name.endsWith('/HEAD'))
}
function safeRef(ref: string): void {
    if (!ref || ref.startsWith('-') || /[\s\0]/.test(ref)) throw new Error('Invalid comparison reference')
}
export async function commits(
    repository: Repository,
    branch = '',
    view: 'introduced' | 'history' = 'history',
    base = repository.base
): Promise<Activity[]> {
    if (branch) safeRef(branch)
    safeRef(base)
    const range = branch ? (view === 'introduced' ? `${base}..${branch}` : branch) : '--all'
    const output = await git(repository.path, ['log', range, '--format=%H%x00%aI%x00%ae%x00%s%x00%B%x1e', '--'])
    return output
        .split('\x1e')
        .filter((row) => row.trim())
        .map((row) => {
            const [sha, date, author, title, description] = row.trimStart().split('\0')
            return {
                id: `${repository.id}:commit:${sha}`,
                repositoryId: repository.id,
                kind: 'commit',
                sha,
                url: githubRemote(repository.remote)
                    ? `https://github.com/${githubRemote(repository.remote)}/commit/${sha}`
                    : undefined,
                date,
                author,
                title,
                description,
                branches: branch ? [branch] : [],
                files: [],
                disposition: 'inbox',
                explicit: false,
                deletedBranches: []
            }
        })
}
export async function commitDetails(
    repository: Repository,
    sha: string
): Promise<{ diff: string; files: Activity['files'] }> {
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid commit hash')
    const names = await git(repository.path, [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--name-status',
        '-r',
        sha,
        '--'
    ])
    const files = names
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [status, ...name] = line.split('\t')
            return { status, name: name.join('\t') }
        })
    const diff = await git(repository.path, ['show', '--format=', '--no-ext-diff', '--no-textconv', sha, '--'])
    return { diff: diff.length > MAX_DIFF ? 'Diff is too large to display. View the source externally.' : diff, files }
}
// Hash the complete net patch, including whitespace, modes, and binary payloads.
// Strip only object IDs and hunk positions: these change across equivalent rewrites.
export function fingerprint(diff: string): string | undefined {
    if (diff.length > MAX_DIFF || (!diff.startsWith('diff --git ') && diff.trim() !== '')) return undefined
    const normalized = diff
        .split('\n')
        .filter((line) => !/^index [a-f0-9]+\.\.[a-f0-9]+/.test(line))
        .map((line) => (line.startsWith('@@ ') ? '@@' : line))
        .join('\n')
    return createHash('sha256').update(normalized).digest('hex')
}
export function githubRemote(remote: string): string | undefined {
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote)
    return match?.[1]
}
