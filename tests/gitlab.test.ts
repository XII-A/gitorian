import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { makeGitLab } from '../src/main/gitlab'
import type { Repository } from '../src/shared/model'
import { filesFromDiff } from '../src/main/diff-files'
import { sampleState } from './workspace-fixture'

// An old untracked MR can gain the week's only contribution without its head or
// updated_at changing. Reconciliation must find it, and must not invent approvals.
it('discovers old review-only contributions using stable note dates', async () => {
    const repo: Repository = {
        id: 'repo',
        name: 'Repo',
        path: '',
        remote: 'git@gitlab.com:team/sub/repo.git',
        base: 'main',
        trackingStart: '2026-10-01',
        emails: ['me@example.test'],
        available: false,
        removed: false,
        branchBases: {},
        branches: []
    }
    const mr = {
        iid: 1,
        title: 'Old work',
        description: '',
        web_url: 'https://gitlab.com/team/sub/repo/-/merge_requests/1',
        author: { id: 11, username: 'other' },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        state: 'opened',
        source_branch: 'topic',
        target_branch: 'main',
        sha: 'abc',
        diff_refs: { base_sha: 'base', head_sha: 'abc', start_sha: 'base' }
    }
    const request = <A>(path: string): Effect.Effect<A, Error> =>
        Effect.succeed(
            (path.includes('/notes')
                ? [
                      {
                          id: 9,
                          body: 'Please handle failure',
                          author: { id: 42, username: 'me' },
                          created_at: '2026-10-25T10:00:00Z',
                          system: false
                      }
                  ]
                : path.includes('/commits')
                  ? []
                  : path.includes('merge_requests?')
                    ? [mr]
                    : mr) as A
        )
    const client = makeGitLab(request, '42')
    const events = await Effect.runPromise(client.activities(repo, 'me', []))
    expect(events.filter((e) => e.kind === 'review').map((e) => [e.date, e.description])).toEqual([
        ['2026-10-25T10:00:00Z', 'Please handle failure']
    ])
    expect(events.some((e) => e.title.includes('Approved'))).toBe(false)
})

it('rejects incomplete merge-request evidence and preserves rename metadata in complete patches', async () => {
    const state = sampleState('2026-10-26'),
        repo = { ...state.repositories[0], remote: 'https://gitlab.com/team/repo' }
    const activity = {
        ...state.activities.find((a) => a.kind === 'change-request')!,
        head: 'head',
        revisionSource: undefined,
        remoteSource: undefined,
        changeRequestId: 'repo:mr:1'
    }
    let count = '2'
    const mr = () => ({ diff_refs: { base_sha: 'base', head_sha: 'head' }, changes_count: count, state: 'opened' })
    const client = makeGitLab(
        <A>(path: string) =>
            Effect.succeed(
                (path.includes('/diffs')
                    ? [{ old_path: 'old.ts', new_path: 'new.ts', renamed_file: true, diff: '' }]
                    : path.includes('/repository/files/')
                      ? { blob_id: 'same-blob' }
                      : mr()) as A
            ),
        '42'
    )
    await expect(Effect.runPromise(client.snapshot(repo, activity))).rejects.toThrow(/complete/i)
    count = '1000+'
    await expect(Effect.runPromise(client.snapshot(repo, activity))).rejects.toThrow(/complete/i)
    count = '1'
    const result = await Effect.runPromise(client.snapshot(repo, activity))
    expect(filesFromDiff(result.diff)).toEqual([
        { name: 'new.ts', previousName: 'old.ts', status: 'renamed', lineStats: { additions: 0, deletions: 0 } }
    ])
})

it('accepts commit comparisons only when the exact target and complete diff are proven', async () => {
    const repo = { ...sampleState('2026-10-26').repositories[0], remote: 'https://gitlab.com/team/repo' }
    const sha = 'a'.repeat(40),
        parent = 'b'.repeat(40)
    let timeout: boolean | undefined = true,
        target = sha
    const client = makeGitLab(
        <A>(path: string) =>
            Effect.succeed(
                (path.includes('/compare?')
                    ? {
                          compare_timeout: timeout,
                          commit: { id: target },
                          diffs: [{ old_path: 'a.ts', new_path: 'a.ts', diff: '@@ -1 +1 @@\n-old\n+new\n' }]
                      }
                    : { parent_ids: [parent] }) as A
            ),
        '42'
    )
    await expect(Effect.runPromise(client.commitDetails(repo, sha))).rejects.toThrow(/complete/i)
    timeout = undefined
    await expect(Effect.runPromise(client.commitDetails(repo, sha))).rejects.toThrow(/complete/i)
    timeout = false
    target = parent
    await expect(Effect.runPromise(client.commitDetails(repo, sha))).rejects.toThrow(/complete/i)
    target = sha
    expect((await Effect.runPromise(client.commitDetails(repo, sha))).diff).toContain('+new')
})

it('advances reconciliation past already-incomplete merge requests', async () => {
    const repo = {
        ...sampleState('2026-10-26').repositories[0],
        remote: 'https://gitlab.com/team/repo.git',
        emails: ['me@example.test']
    }
    const mrs = Array.from({ length: 20 }, (_, i) => ({
        iid: i + 1,
        author: { id: 99 },
        updated_at: '2026-10-06T00:00:00Z'
    }))
    const incomplete = Object.fromEntries(
        mrs
            .slice(0, 5)
            .map((mr) => [
                `${mr.iid}:${createHash('sha256').update(JSON.stringify(mr)).digest('hex')}`,
                'Unavailable evidence'
            ])
    )
    const calls: string[] = []
    const client = makeGitLab(
        <A>(path: string) =>
            Effect.sync(() => {
                calls.push(path)
                const value: unknown = path.includes('/merge_requests?') && path.includes('per_page=20') ? mrs : []
                return value as A
            }),
        '42'
    )
    let position: number | undefined = 0
    const scan = () => ({
        offset: position,
        incomplete,
        checkpoint: (_page: number, _complete: boolean, offset?: number) =>
            Effect.sync(() => {
                position = offset
            })
    })
    await Effect.runPromise(client.activities(repo, 'me', [], scan()))
    expect(position).toBe(5)
    await Effect.runPromise(client.activities(repo, 'me', [], scan()))
    expect(position).toBe(10)
    expect(calls.some((path) => path.includes('/merge_requests/6/commits'))).toBe(true)
})
