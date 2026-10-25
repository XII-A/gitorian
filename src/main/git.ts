import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Activity, Repository } from '../shared/model'
import { localDate } from '../shared/model'
import { WorkQueue } from './work-queue'

const execute = promisify(execFile)
const MAX_DIFF = 2_000_000
const processes = new WorkQueue(3)
export interface GitHistory {
    configuration: string
    refs: Record<string, string>
    items: Activity[]
    nextOffset?: number
    excludedTips?: string[]
}
export async function git(path: string, args: string[], background = false, maxBuffer = 16_000_000): Promise<string> {
    const result = await processes.run(
        () =>
            execute('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], {
                cwd: path,
                encoding: 'utf8',
                maxBuffer,
                timeout: 30000,
                windowsHide: true,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }
            }),
        background ? 0 : 1
    )
    return result.stdout
}
export async function inspectRepository(path: string): Promise<{
    path: string
    name: string
    remotes: string[]
    githubRemote: string
    base: string
    email: string
    branches: string[]
}> {
    const root = await realpath((await git(path, ['rev-parse', '--show-toplevel'])).trim())
    const [remoteOutput, branchOutput, origin, email] = await Promise.all([
        git(root, ['remote', '-v'], true),
        git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], true),
        git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], true).catch(() => ''),
        git(root, ['config', 'user.email'], true).catch(() => '')
    ])
    const fetchRemotes = remoteOutput
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => {
            const [name, url] = line.split(/\s+/)
            return { name, url }
        })
        .filter((remote) => remote.url)
    const candidates = fetchRemotes.filter((remote) => githubRemote(remote.url))
    const selected =
        candidates.find((remote) => remote.name === 'upstream') ??
        candidates.find((remote) => remote.name === 'origin') ??
        candidates[0]
    const refs = branchOutput
        .trim()
        .split('\n')
        .filter((ref) => ref.startsWith('refs/heads/'))
        .map((ref) => ref.slice(11))
    let base = refs.includes('development')
        ? 'development'
        : refs.includes('main')
          ? 'main'
          : refs.includes('master')
            ? 'master'
            : refs[0] || 'main'
    if (origin.trim()) base = origin.trim().replace(/^origin\//, '')
    const branchNames = branchOutput
        .trim()
        .split('\n')
        .map((name) => name.replace(/^refs\/(?:heads|remotes)\//, ''))
        .filter((name) => name && !name.endsWith('/HEAD'))
    return {
        path: root,
        name: basename(root),
        remotes: [...new Set(fetchRemotes.map((remote) => remote.url))],
        githubRemote: selected?.url ?? '',
        base,
        email: email.trim(),
        branches: branchNames
    }
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
    base = repository.base,
    since = '',
    background = false,
    offset = 0,
    limit = 20000,
    excludedTips: string[] = []
): Promise<Activity[]> {
    if (branch) safeRef(branch)
    safeRef(base)
    const range = branch ? (view === 'introduced' ? `${base}..${branch}` : branch) : '--all'
    const output = await git(
        repository.path,
        [
            'log',
            range,
            `--max-count=${limit}`,
            `--skip=${offset}`,
            ...(excludedTips.length ? ['--not', ...excludedTips] : []),
            '--format=%H%x00%aI%x00%ae%x00%s%x00%B%x1e',
            '--'
        ],
        background
    )
    return output
        .split('\x1e')
        .filter((row) => row.trim())
        .map<Activity>((row) => {
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
        .filter((activity) => !since || activity.date.slice(0, 10) >= since)
}
export async function commitDetails(
    repository: Repository,
    sha: string,
    includeDiff = true
): Promise<{ diff: string; files: Activity['files'] }> {
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid commit hash')
    const comparison = [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--diff-merges=first-parent',
        '-z',
        '-M',
        '-r',
        sha,
        '--'
    ]
    const [names, numstat] = await Promise.all([
        git(repository.path, [...comparison.slice(0, -1), '--name-status', '--']),
        git(repository.path, [...comparison.slice(0, -1), '--numstat', '--no-ext-diff', '--no-textconv', '--'])
    ])
    const statistics = new Map<string, Activity['files'][number]['lineStats']>()
    const records = numstat.split('\0')
    for (let index = 0; index < records.length && records[index];) {
        const record = records[index++]
        const first = record.indexOf('\t'),
            second = record.indexOf('\t', first + 1)
        const additions = record.slice(0, first),
            deletions = record.slice(first + 1, second)
        let name = record.slice(second + 1)
        if (!name) {
            index++
            name = records[index++]
        }
        statistics.set(
            name,
            additions === '-' || deletions === '-'
                ? null
                : { additions: Number(additions), deletions: Number(deletions) }
        )
    }
    // NUL delimiters preserve filenames containing tabs, newlines, or spaces.
    const paths = names.split('\0')
    const files: Activity['files'] = []
    for (let index = 0; index < paths.length && paths[index];) {
        const status = paths[index++]
        const firstPath = paths[index++]
        if (/^[RC]/.test(status)) {
            files.push({ status, previousName: firstPath, name: paths[index++] })
        } else files.push({ status, name: firstPath })
    }
    for (const file of files) file.lineStats = statistics.get(file.name)
    let diff = ''
    if (includeDiff) {
        try {
            diff = await git(
                repository.path,
                ['show', '--format=', '--diff-merges=first-parent', '--no-ext-diff', '--no-textconv', sha, '--'],
                false,
                MAX_DIFF
            )
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
                diff = 'Diff is too large to display. View the source externally.'
            else throw error
        }
    }
    return { diff: diff.length > MAX_DIFF ? 'Diff is too large to display. View the source externally.' : diff, files }
}

/** Read shared commit bodies once; branch membership uses compact SHA-only walks. */
export async function indexCommits(
    repository: Repository,
    previous: Record<string, string>,
    since: string,
    offset = 0,
    excludedTips: string[] = [],
    known: Activity[] = [],
    timezone = 'UTC'
): Promise<{
    refs: Record<string, string>
    items: Activity[]
    history?: Activity[]
    nextOffset?: number
    excludedTips?: string[]
}> {
    const output = await git(
        repository.path,
        ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads', 'refs/remotes'],
        true
    )
    const refs: Record<string, string> = Object.fromEntries(
        output
            .trim()
            .split('\n')
            .filter((row) => row && !row.split('\0')[0].endsWith('/HEAD'))
            .map((row) => row.split('\0'))
    )
    if (!Object.keys(refs).length) return { refs, items: [] }
    const same = JSON.stringify(refs) === JSON.stringify(previous)
    if (same && !offset)
        return {
            refs,
            items: known.filter((activity) => localDate(new Date(activity.date), timezone) >= since),
            history: known
        }
    if (!same) {
        excludedTips = offset ? excludedTips : [...new Set(Object.values(previous))]
        offset = 0
    }
    let captured: Activity[]
    try {
        captured = await commits(repository, '', 'history', repository.base, '', true, offset, 2000, excludedTips)
    } catch (error) {
        if (
            !excludedTips.length ||
            !(error instanceof Error) ||
            !/bad object|bad revision|unknown revision/i.test(error.message)
        )
            throw error
        excludedTips = []
        offset = 0
        captured = await commits(repository, '', 'history', repository.base, '', true, offset, 2000)
    }
    const items = [
        ...new Map(
            [...known, ...captured].map((activity) => [activity.id, { ...activity, branches: [...activity.branches] }])
        ).values()
    ]
    for (const [branch, tip] of Object.entries(refs)) {
        if (!offset && excludedTips.length && previous[branch] === tip) continue
        const membership = new Set(
            (await git(repository.path, ['rev-list', `--max-count=${offset + 2000}`, tip, '--'], true))
                .trim()
                .split('\n')
        )
        for (const item of items)
            if (membership.has(item.sha!) && !item.branches.includes(branch)) item.branches.push(branch)
    }
    return {
        refs,
        items: items.filter((activity) => localDate(new Date(activity.date), timezone) >= since),
        history: items,
        nextOffset: captured.length === 2000 ? offset + 2000 : undefined,
        excludedTips
    }
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
    const match =
        /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
            remote
        )
    return match?.[1]
}
