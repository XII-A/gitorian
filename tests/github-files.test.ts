import { expect, it } from 'vitest'
import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'
import { activitySchema } from '../src/shared/model'
import { sampleState } from '../src/renderer/workspace-sample'

it('retains rename paths from GitHub PR and commit metadata through state validation', async () => {
    const state = sampleState('2026-10-05')
    const files = [{ filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed' }]
    const http = new Http((input) =>
        Promise.resolve(
            new Response(
                JSON.stringify(
                    (input instanceof Request ? input.url : input.toString()).includes('/pulls/') ? files : { files }
                ),
                { status: 200 }
            )
        )
    )
    const github = new GitHub(
        http,
        () => 'test-token',
        () => {
            throw new Error('This metadata fixture must not change authentication')
        }
    )
    const expected = [{ name: 'src/new.ts', previousName: 'src/old.ts', status: 'renamed' }]
    expect(await github.files(state.repositories[0], state.activities[8])).toEqual(expected)
    expect((await github.commitDetails(state.repositories[0], 'a'.repeat(40), false)).files).toEqual(expected)
    expect(activitySchema.parse({ ...state.activities[8], files: expected }).files).toEqual(expected)
})
