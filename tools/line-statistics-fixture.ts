import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initialState, type Activity, type Repository } from '../src/shared/model'

const scratch = process.env.WEEKLY_J_VERIFY_STATE!
const output = process.env.WEEKLY_J_VERIFY_OUTPUT!
const repositoryPath = join(scratch, 'retry-scheduler')
mkdirSync(repositoryPath, { recursive: true })
const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8', windowsHide: true }).trim()
const file = (name: string, text: string | Buffer) => {
    mkdirSync(dirname(join(repositoryPath, name)), { recursive: true })
    writeFileSync(join(repositoryPath, name), text)
}
git('init', '-b', 'main')
git('config', 'user.name', 'Fixture author')
git('config', 'user.email', 'fixture@example.com')
git('config', 'core.autocrlf', 'false')
const lines = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n') + '\n'
file('src/retry.ts', lines('// Previous retry strategy', 7))
file('tests/retry.test.ts', '// Previous retry test\n')
file('evals/reconnect.eval.ts', lines('// Previous reconnect case', 36))
file('package.json', '{"version":"1"}\n')
file('src/legacy.ts', 'export const retries = 5\n')
file('assets/retry.bin', Buffer.from([0, 1, 2]))
git('add', '.')
git('commit', '-m', 'Initial scheduler')
file('src/retry.ts', lines('// Schedule pending uploads with bounded exponential backoff.', 55))
file('tests/retry.test.ts', lines('// Verify queued uploads survive a lost connection.', 77))
file('evals/reconnect.eval.ts', lines('// Replay offline recovery and score retry outcomes.', 503))
file('docs/retries.md', lines('Document retry scheduling and recovery.', 10))
file('package.json', '{\n  "version":"2"}\n')
file('assets/retry.bin', Buffer.from([0, 4, 5]))
git('mv', 'src/legacy.ts', 'src/renamed.ts')
git('add', '.')
git('commit', '-m', 'Add reliable retry scheduling and regression coverage')
const sha = git('rev-parse', 'HEAD')
git('commit', '--allow-empty', '-m', 'Record scheduler rollout checkpoint')
const now = new Date().toISOString()
const state = initialState()
state.settings.refreshMinutes = 0
state.settings.timezone = 'Europe/Istanbul'
state.settings.githubLogin = 'fixture-author'
const repository: Repository = {
    id: 'line-fixture',
    name: 'retry-scheduler',
    path: repositoryPath,
    remote: 'https://github.com/weekly-j-fixture/retry-scheduler.git',
    base: 'main',
    trackingStart: now.slice(0, 10),
    emails: ['fixture@example.com'],
    available: true,
    removed: false,
    branchBases: {},
    branches: ['main']
}
const files: Activity['files'] = [
    { name: 'src/retry.ts', status: 'M', lineStats: { additions: 55, deletions: 7 } },
    { name: 'tests/retry.test.ts', status: 'M', lineStats: { additions: 77, deletions: 1 } },
    { name: 'evals/reconnect.eval.ts', status: 'M', lineStats: { additions: 503, deletions: 36 } },
    { name: 'docs/retries.md', status: 'A', lineStats: { additions: 10, deletions: 0 } },
    { name: 'package.json', status: 'M', lineStats: { additions: 2, deletions: 1 } },
    {
        name: 'src/renamed.ts',
        previousName: 'src/legacy.ts',
        status: 'R100',
        lineStats: { additions: 0, deletions: 0 }
    },
    { name: 'assets/retry.bin', status: 'M', lineStats: null }
]
const commit: Activity = {
    id: `${repository.id}:commit:${sha}`,
    repositoryId: repository.id,
    kind: 'commit',
    sha,
    title: 'Add reliable retry scheduling and regression coverage',
    date: now,
    author: 'fixture@example.com',
    description:
        'Keep pending uploads safe through connection loss.\n\nAdd bounded backoff, regression tests, and reconnect evaluations.',
    branches: ['main'],
    files: files.map(({ name, status, previousName }) => ({ name, status, previousName })),
    filesLoaded: true,
    disposition: 'inbox',
    explicit: false,
    deletedBranches: []
}
const pr: Activity = {
    ...commit,
    id: `${repository.id}:pr:42`,
    kind: 'pr',
    sha: undefined,
    prId: `${repository.id}:pr:42`,
    title: '#42 Keep queued uploads safe across reconnects',
    author: 'fixture-author',
    url: 'https://github.com/weekly-j-fixture/retry-scheduler/pull/42',
    files: [],
    filesLoaded: false,
    description:
        '## Reliable offline recovery\n\nPreserve pending uploads and retry them safely when connectivity returns. Includes regression coverage and reconnect evaluations.',
    pullRequest: { status: 'open', openedAt: now, commitDates: [now] },
    base: 'main',
    head: sha
}
state.repositories = [repository]
state.activities = [commit, pr]
const profile = join(scratch, 'profile')
mkdirSync(profile, { recursive: true })
const db = new DatabaseSync(join(profile, 'weekly-j.sqlite'))
db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)')
db.prepare('INSERT INTO state VALUES (1, ?)').run(JSON.stringify(state))
db.close()
const fixture = {
    repositoryPath: resolve(repositoryPath),
    sha,
    commitId: commit.id,
    prId: pr.id,
    expected: { additions: 647, deletions: 45 },
    githubFiles: files
        .filter((file) => file.lineStats !== null)
        .map((file) => ({
            filename: file.name,
            status: file.status,
            previous_filename: file.previousName,
            ...file.lineStats
        }))
}
writeFileSync(join(output, 'fixture.json'), JSON.stringify(fixture, null, 2))
