import { expect, it } from 'vitest'
import { providerRemote, chooseAccount } from '../src/shared/provider-accounts'

// Failure modes: token routing to an arbitrary host; nested namespace truncation;
// public readability mistaken for identity; a transient failure mistaken for denial.
it('recognizes cloud remotes without allowing arbitrary credential destinations', () => {
    expect(providerRemote('git@gitlab.com:team/group/project.git')).toEqual({
        provider: 'gitlab',
        host: 'gitlab.com',
        path: 'team/group/project'
    })
    expect(providerRemote('https://github.com/team/project.git')?.path).toBe('team/project')
    for (const remote of [
        'https://github.com.evil.test/a/b',
        'https://user:secret@gitlab.com/a/b',
        'git@work:a/b',
        'https://gitlab.com/a/../b',
        'https://gitlab.com/a/b?token=x'
    ])
        expect(providerRemote(remote)).toBeUndefined()
})

it('requires identity evidence when multiple accounts can read a public project', () => {
    const candidates = [
        { id: 'personal', access: 'allowed' as const, identity: false },
        { id: 'work', access: 'allowed' as const, identity: false }
    ]
    expect(chooseAccount(candidates)).toBeUndefined()
    expect(chooseAccount([{ ...candidates[0], identity: true }, candidates[1]])).toBe('personal')
    expect(
        chooseAccount([
            { ...candidates[0], identity: true },
            { ...candidates[1], identity: true, emailMatch: true }
        ])
    ).toBe('work')
    expect(chooseAccount([candidates[0], { ...candidates[1], access: 'unknown' }])).toBeUndefined()
    expect(chooseAccount([candidates[0], { ...candidates[1], access: 'denied' }])).toBe('personal')
})
