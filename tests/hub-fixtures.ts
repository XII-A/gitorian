import { initialState, type Activity, type Repository } from '../src/shared/model'

export function hubRepository(index = 0, overrides: Partial<Repository> = {}): Repository {
    return {
        id: `repo-${index}`,
        name: `platform-service-${String(index + 1).padStart(3, '0')}`,
        path: `C:/fixture/team-${index}/repository`,
        remote: '',
        base: 'main',
        trackingStart: '2026-01-01',
        emails: [],
        available: false,
        removed: false,
        branchBases: {},
        branches: ['main'],
        ...overrides
    }
}

export function hubActivity(index = 0, overrides: Partial<Activity> = {}): Activity {
    return {
        id: `activity-${index}`,
        repositoryId: 'repo-0',
        kind: 'commit',
        title: `Improve request processing (${index + 1})`,
        date: new Date().toISOString(),
        author: 'Fixture author',
        disposition: 'inbox',
        explicit: false,
        deletedBranches: [],
        branches: ['feature/recovery'],
        sha: (index + 1).toString(16).padStart(40, '0'),
        description: '',
        files: [],
        filesLoaded: true,
        ...overrides
    }
}

/** Test-only stored records, shared by domain checks and the compiled Electron journey. */
export function largeHubFixture() {
    const state = initialState()
    state.settings.refreshMinutes = 0
    state.settings.timezone = 'UTC'
    state.repositories = Array.from({ length: 256 }, (_, index) => hubRepository(index))
    const date = new Date().toISOString()
    state.activities = Array.from({ length: 1024 }, (_, index) =>
        hubActivity(index, { repositoryId: state.repositories[index % 256].id, date })
    )
    return state
}
