import { transportClient, githubClient, run } from './effect-fixtures'
import { expect, it } from 'vitest'
import { activitySchema } from '../src/shared/model'
import { sampleState } from '../src/renderer/workspace-sample'
import { summarizeChanges } from '../src/shared/change-statistics'
it('retains rename paths from GitHub PR and commit metadata through state validation', async () => {
    const state = sampleState('2026-10-05')
    const files = [
        { filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 12, deletions: 3 }
    ]
    const http = await transportClient((input) =>
        Promise.resolve(
            new Response(
                JSON.stringify(
                    (input instanceof Request ? input.url : input.toString()).includes('/pulls/') ? files : { files }
                ),
                { status: 200 }
            )
        )
    )
    const github = await githubClient(http, () => 'test-token')
    const expected = [
        {
            name: 'src/new.ts',
            previousName: 'src/old.ts',
            status: 'renamed',
            lineStats: { additions: 12, deletions: 3 }
        }
    ]
    expect(await run(github.files(state.repositories[0], state.activities[8]))).toEqual(expected)
    expect((await run(github.commitDetails(state.repositories[0], 'a'.repeat(40), false))).files).toEqual(expected)
    expect(activitySchema.parse({ ...state.activities[8], files: expected }).files).toEqual(expected)
})
it('includes every metadata page in PR and remote commit line totals without requesting a patch', async () => {
    const state = sampleState('2026-10-05')
    const urls: string[] = []
    const http = await transportClient((input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        urls.push(url.href)
        const second = url.searchParams.get('page') === '2'
        const files = Array.from({ length: second ? 1 : 100 }, (_, index) => ({
            filename: `src/file-${second ? 100 : index}.ts`,
            status: 'modified',
            additions: 2,
            deletions: 1
        }))
        return Promise.resolve(new Response(JSON.stringify(url.pathname.includes('/pulls/') ? files : { files })))
    })
    const github = await githubClient(http, () => 'fixture-token')
    for (const files of [
        await run(github.files(state.repositories[0], state.activities[8])),
        (await run(github.commitDetails(state.repositories[0], 'a'.repeat(40), false))).files
    ]) {
        expect(files).toHaveLength(101)
        expect(summarizeChanges(files).total).toEqual({ additions: 202, deletions: 101 })
    }
    expect(urls).toHaveLength(4)
})
