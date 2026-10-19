import type { Repository, State } from './model'

// Coverage belongs to a source configuration, rather than just a calendar date.
export const gitConfiguration = (repository: Repository, state: State) =>
    JSON.stringify([repository.path, repository.remote, repository.emails, state.restoreId])
export const githubConfiguration = (repository: Repository, state: State) =>
    JSON.stringify([repository.remote, repository.emails, state.settings.githubLogin])
