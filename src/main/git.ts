import { providerRemote } from '../shared/provider-accounts'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Activity, Repository, State } from '../shared/model'
import { localDate } from '../shared/model'
import { WorkQueue } from './work-queue'

const execute = promisify(execFile)
const MAX_DIFF = 2_000_000
const processes = new WorkQueue(3)
export type GitCursor = NonNullable<NonNullable<State['acquisition']>[string]['gitCursor']>
export interface GitHistory {
    configuration: string
    refs: Record<string, string>
    items: Activity[]
    memberships?: { branches: string[]; shas: string[] }[]
    nextOffset?: number
    excludedTips?: string[]
}
export async function git(
    path: string,
    args: string[],
    background = false,
    maxBuffer = 16_000_000,
    signal?: AbortSignal
): Promise<string> {
    const result = await processes.run(
        () =>
            execute('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], {
                cwd: path,
                encoding: 'utf8',
                maxBuffer,
                timeout: 30000,
                signal,
                windowsHide: true,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }
            }),
        background ? 0 : 1,
        signal
    )
    return result.stdout
}
/** Stream bounded message previews; a pathological body never fills execFile's stdout buffer. */
async function historyLog(
    path: string,
    args: string[],
    background: boolean,
    signal?: AbortSignal,
    input?: string
): Promise<string[]> {
    return processes.run(
        () =>
            new Promise<string[]>((resolve, reject) => {
                const child = spawn('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], {
                    cwd: path,
                    windowsHide: true,
                    signal,
                    timeout: 30000,
                    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
                    stdio: ['pipe', 'pipe', 'pipe']
                })
                child.stdin.on('error', () => {
                    /* Process failure is reported on close/error. */
                })
                child.stdin.end(input)
                const rows: string[] = []
                let row = '',
                    fields: string[] = [],
                    oversized = false,
                    stderr = ''
                child.stdout.setEncoding('utf8')
                child.stderr.setEncoding('utf8')
                child.stderr.on('data', (chunk: string) => {
                    stderr = (stderr + chunk).slice(-4096)
                })
                child.stdout.on('data', (chunk: string) => {
                    let start = 0
                    for (;;) {
                        const end = chunk.indexOf('\0', start)
                        const part = chunk.slice(start, end < 0 ? undefined : end)
                        if (row.length + part.length > 8192) oversized = true
                        row = (row + part).slice(0, 8192)
                        if (end < 0) break
                        fields.push(
                            oversized && fields.length === 4
                                ? 'Commit message exceeds the acquisition preview limit. Open the commit in Git to read the complete message.'
                                : row
                        )
                        row = ''
                        oversized = false
                        if (fields.length === 5) {
                            rows.push(fields.join('\0'))
                            fields = []
                        }
                        start = end + 1
                    }
                })
                child.on('error', reject)
                child.on('close', (code) =>
                    code === 0 ? resolve(rows) : reject(new Error(stderr || `Git history failed (${code})`))
                )
            }),
        background ? 0 : 1,
        signal
    )
}
export async function inspectRepository(
    path: string,
    signal?: AbortSignal
): Promise<{
    path: string
    name: string
    remotes: string[]
    selectedRemote: string
    base: string
    email: string
    branches: string[]
}> {
    const root = await realpath((await git(path, ['rev-parse', '--show-toplevel'], false, 16_000_000, signal)).trim())
    const [remoteOutput, branchOutput, origin, email] = await Promise.all([
        git(root, ['remote', '-v'], true, 16_000_000, signal),
        git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], true, 16_000_000, signal),
        git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], true, 16_000_000, signal).catch(() => ''),
        git(root, ['config', 'user.email'], true, 16_000_000, signal).catch(() => '')
    ])
    signal?.throwIfAborted()
    const fetchRemotes = remoteOutput
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => {
            const [name, url] = line.split(/\s+/)
            return { name, url }
        })
        .filter((remote) => remote.url)
    const candidates = fetchRemotes.filter((remote) => providerRemote(remote.url))
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
        selectedRemote: selected?.url ?? '',
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
    excludedTips: string[] = [],
    signal?: AbortSignal,
    tips?: string[]
): Promise<Activity[]> {
    if (branch) safeRef(branch)
    safeRef(base)
    const range = branch ? (view === 'introduced' ? `${base}..${branch}` : branch) : '--all'
    const rows = await historyLog(
        repository.path,
        [
            'log',
            ...(tips ? ['--stdin'] : [range]),
            `--max-count=${limit}`,
            `--skip=${offset}`,
            ...(excludedTips.length ? ['--not', ...excludedTips] : []),
            '--format=%H%x00%aI%x00%ae%x00%<(200,trunc)%s%x00%B%x00',
            '--'
        ],
        background,
        signal,
        tips?.map((tip) => tip + '\n').join('')
    )
    return rows
        .filter((row) => row.trim())
        .map<Activity>((row) => {
            const [sha, date, author, title, description] = row.trimStart().split('\0')
            if (
                !/^[a-f0-9]{40,64}$/.test(sha) ||
                !Number.isFinite(Date.parse(date)) ||
                title === undefined ||
                description === undefined
            )
                throw new Error('Git returned malformed commit metadata.')
            return {
                id: `${repository.id}:commit:${sha}`,
                repositoryId: repository.id,
                kind: 'commit',
                sha,
                url: providerRemote(repository.remote)
                    ? `https://${providerRemote(repository.remote)!.host}/${providerRemote(repository.remote)!.path}/${providerRemote(repository.remote)!.provider === 'gitlab' ? '-/commit' : 'commit'}/${sha}`
                    : undefined,
                date,
                author,
                title: title.trimEnd(),
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
    timezone = 'UTC',
    signal?: AbortSignal,
    cursor?: GitCursor
): Promise<{
    refs: Record<string, string>
    items: Activity[]
    history?: Activity[]
    memberships?: { branches: string[]; shas: string[] }[]
    nextOffset?: number
    excludedTips?: string[]
    cursor?: GitCursor
}> {
    // A continuation walks immutable tip objects, never a moving --all traversal.
    const output = cursor
        ? ''
        : await git(
              repository.path,
              ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads', 'refs/remotes'],
              true,
              16_000_000,
              signal
          )
    const refs: Record<string, string> = cursor
        ? previous
        : Object.fromEntries(
              output
                  .trim()
                  .split('\n')
                  .filter((row) => row && !row.split('\0')[0].endsWith('/HEAD'))
                  .map((row) => row.split('\0'))
          )
    if (!Object.keys(refs).length) return { refs, items: [] }
    if (!cursor && !offset && JSON.stringify(refs) === JSON.stringify(previous)) return { refs, items: [] }
    const groups = new Map<string, string[]>()
    for (const [branch, tip] of Object.entries(refs)) groups.set(tip, [...(groups.get(tip) ?? []), branch])
    let state: GitCursor = cursor ? { ...cursor } : { phase: 'body', offset: 0, group: 0, alias: 0 }
    if (!cursor && offset) excludedTips = []
    let captured: Activity[] = []
    if (state.phase === 'body') {
        // Legacy partial snapshots restart safely; new cursors preserve the frozen source snapshot.
        if (!cursor && JSON.stringify(refs) !== JSON.stringify(previous)) {
            excludedTips = offset ? [] : [...new Set(Object.values(previous))]
            state.offset = 0
        }
        try {
            captured = await commits(
                repository,
                '',
                'history',
                repository.base,
                '',
                true,
                state.offset,
                2000,
                excludedTips,
                signal,
                [...groups.keys()]
            )
        } catch (error) {
            if (
                !excludedTips.length ||
                !(error instanceof Error) ||
                !/bad object|bad revision|unknown revision/i.test(error.message)
            )
                throw error
            excludedTips = []
            state.offset = 0
            captured = await commits(repository, '', 'history', repository.base, '', true, 0, 2000, [], signal, [
                ...groups.keys()
            ])
        }
        state =
            captured.length === 2000
                ? { ...state, offset: state.offset + 2000 }
                : { phase: 'membership', offset: 0, group: 0, alias: 0 }
    }
    const memberships: { branches: string[]; shas: string[] }[] = []
    let membershipWork = 0
    while (state.phase === 'membership' && state.group < groups.size && membershipWork < 1000) {
        const [tip, aliases] = [...groups][state.group]
        const shas = (
            await git(
                repository.path,
                ['rev-list', '--max-count=1000', `--skip=${state.offset}`, tip, '--'],
                true,
                1_000_000,
                signal
            )
        )
            .trim()
            .split('\n')
            .filter(Boolean)
        membershipWork += Math.max(1, shas.length) * Math.min(25, aliases.length - state.alias)
        const names = aliases.slice(state.alias, state.alias + 25)
        memberships.push({ branches: names, shas })
        const matches = new Set(shas)
        for (const item of captured) if (matches.has(item.sha!)) item.branches.push(...names)
        if (state.alias + 25 < aliases.length) state = { ...state, alias: state.alias + 25 }
        else if (shas.length === 1000) state = { ...state, alias: 0, offset: state.offset + 1000 }
        else state = { ...state, alias: 0, offset: 0, group: state.group + 1 }
    }
    const next = state.phase === 'body' || state.group < groups.size ? state : undefined
    return {
        refs,
        items: captured.filter((activity) => localDate(new Date(activity.date), timezone) >= since),
        history: captured,
        memberships,
        cursor: next,
        nextOffset: next ? (next.phase === 'body' ? next.offset : -1) : undefined,
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
