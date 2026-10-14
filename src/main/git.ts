import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import nodePath from 'node:path'
import { promisify } from 'node:util'

import type { Activity, Repository } from '../shared/model'
import { required } from '../shared/required'
import { WorkQueue } from './work-queue'

const execute = promisify(execFile)
const MAX_DIFF = 2_000_000
const processes = new WorkQueue(3)
export const git = async (
    path: string,
    args: string[],
    background = false,
    maxBuffer = 16_000_000
): Promise<string> => {
    const result = await processes.run(
        () =>
            Promise.resolve(
                execute('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], {
                    cwd: path,
                    encoding: 'utf-8',
                    env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
                    maxBuffer,
                    timeout: 30_000,
                    windowsHide: true
                })
            ),
        background ? 0 : 1
    )
    return result.stdout
}
export const inspectRepository = async (
    path: string
): Promise<{ path: string; name: string; remotes: string[]; base: string; email: string; branches: string[] }> => {
    const awaited1 = await git(path, ['rev-parse', '--show-toplevel'])
    const root = await realpath(awaited1.trim())
    const [remoteOutput, branchOutput, origin, email] = await Promise.all([
        git(root, ['remote', '-v'], true),
        git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], true),
        git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], true).catch(() => ''),
        git(root, ['config', 'user.email'], true).catch(() => '')
    ])
    const remotes = remoteOutput
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => line.split(/\s+/u)[1])
        .filter(Boolean)
    const refs = branchOutput
        .trim()
        .split('\n')
        .filter((ref) => ref.startsWith('refs/heads/'))
        .map((ref) => ref.slice(11))
    let base = (() => {
        if (refs.includes('development')) {
            return 'development'
        }
        if (refs.includes('main')) {
            return 'main'
        }
        if (refs.includes('master')) {
            return 'master'
        }

        return refs[0] || 'main'
    })()
    if (origin.trim()) {
        base = origin.trim().replace(/^origin\//u, '')
    }
    const branchNames = branchOutput
        .trim()
        .split('\n')
        .map((name) => name.replace(/^refs\/(?:heads|remotes)\//u, ''))
        .filter((name) => name && !name.endsWith('/HEAD'))
    return {
        base,
        branches: branchNames,
        email: email.trim(),
        name: nodePath.basename(root),
        path: root,
        remotes: [...new Set(remotes)]
    }
}
export const branches = async (repository: Repository): Promise<string[]> => {
    const awaited2 = await git(repository.path, [
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads',
        'refs/remotes'
    ])
    return awaited2
        .trim()
        .split('\n')
        .filter((name) => name && !name.endsWith('/HEAD'))
}

const safeRef = (ref: string): void => {
    if (!ref || ref.startsWith('-') || /[\s\0]/u.test(ref)) {
        throw new Error('Invalid comparison reference')
    }
}
export const githubRemote = (remote: string): string | undefined => {
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)(?<group1>[\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/u.exec(
        remote
    )
    return match?.[1]
}

export const commits = async (
    repository: Repository,
    branch = '',
    view: 'introduced' | 'history' = 'history',
    base = repository.base,
    since = '',
    background = false,
    offset = 0,
    limit = 20_000,
    excludedTips: string[] = []
): Promise<Activity[]> => {
    if (branch) {
        safeRef(branch)
    }
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
        .split('\u001E')
        .filter((row) => row.trim())
        .map<Activity>((row) => {
            const [sha, date, author, title, description] = row.trimStart().split('\0')
            return {
                author,
                branches: branch ? [branch] : [],
                date,
                deletedBranches: [],
                description,
                disposition: 'inbox',
                explicit: false,
                files: [],
                id: `${repository.id}:commit:${sha}`,
                kind: 'commit',
                repositoryId: repository.id,
                sha,
                title,
                url: githubRemote(repository.remote)
                    ? `https://github.com/${githubRemote(repository.remote)}/commit/${sha}`
                    : undefined
            }
        })
        .filter((activity) => !since || activity.date.slice(0, 10) >= since)
}
export const commitDetails = async (
    repository: Repository,
    sha: string,
    includeDiff = true
): Promise<{ diff: string; files: Activity['files'] }> => {
    if (!/^[a-f0-9]{40,64}$/u.test(sha)) {
        throw new Error('Invalid commit hash')
    }
    const names = await git(repository.path, [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--name-status',
        '--diff-merges=first-parent',
        '-z',
        '-M',
        '-r',
        sha,
        '--'
    ])
    // NUL delimiters preserve filenames containing tabs, newlines, or spaces.
    const paths = names.split('\0')
    const files: Activity['files'] = []
    for (let index = 0; index < paths.length && paths[index];) {
        const status = paths[(index += 1) - 1]
        const firstPath = paths[(index += 1) - 1]
        if (/^[RC]/u.test(status)) {
            files.push({ name: paths[(index += 1) - 1], previousName: firstPath, status })
        } else {
            files.push({ name: firstPath, status })
        }
    }
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
            if (error instanceof Error && 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                diff = 'Diff is too large to display. View the source externally.'
            } else {
                throw error
            }
        }
    }
    return { diff: diff.length > MAX_DIFF ? 'Diff is too large to display. View the source externally.' : diff, files }
}

/** Read shared commit bodies once; branch membership uses compact SHA-only walks. */
export const indexCommits = async (
    repository: Repository,
    previous: Record<string, string>,
    since: string,
    initialOffset = 0,
    initialExcludedTips: string[] = [],
    known: Activity[] = []
): Promise<{ refs: Record<string, string>; items: Activity[]; nextOffset?: number; excludedTips?: string[] }> => {
    let offset = initialOffset
    let excludedTips = initialExcludedTips
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
    if (!Object.keys(refs).length) {
        return { items: [], refs }
    }
    const same = JSON.stringify(refs) === JSON.stringify(previous)
    if (same && !offset) {
        return { items: [], refs }
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
            !/bad object|bad revision|unknown revision/iu.test(error.message)
        ) {
            throw error
        }
        excludedTips = []
        offset = 0
        captured = await commits(repository, '', 'history', repository.base, '', true, offset, 2000)
    }
    const items = [
        ...new Map(
            [...known, ...captured]
                .filter((activity) => activity.date.slice(0, 10) >= since)
                .map((activity) => [activity.id, { ...activity, branches: [...activity.branches] }])
        ).values()
    ]
    for await (const [branch, tip] of Object.entries(refs)) {
        if (!offset && excludedTips.length && previous[branch] === tip) {
            continue
        }
        const awaited3 = await git(repository.path, ['rev-list', `--max-count=${offset + 2000}`, tip, '--'], true)
        const membership = new Set(awaited3.trim().split('\n'))
        for (const item of items) {
            if (membership.has(required(item.sha)) && !item.branches.includes(branch)) {
                item.branches.push(branch)
            }
        }
    }
    return { excludedTips, items, nextOffset: captured.length === 2000 ? offset + 2000 : undefined, refs }
}
// Hash the complete net patch, including whitespace, modes, and binary payloads.
// Strip only object IDs and hunk positions: these change across equivalent rewrites.
export const fingerprint = (diff: string): string | undefined => {
    if (diff.length > MAX_DIFF || (!diff.startsWith('diff --git ') && diff.trim() !== '')) {
        return undefined
    }
    const normalized = diff
        .split('\n')
        .filter((line) => !/^index [a-f0-9]+\.\.[a-f0-9]+/u.test(line))
        .map((line) => (line.startsWith('@@ ') ? '@@' : line))
        .join('\n')
    return createHash('sha256').update(normalized).digest('hex')
}
