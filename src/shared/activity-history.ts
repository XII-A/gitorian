import { remoteConfiguration } from './provider-accounts'
import type { Repository, State } from './model'

// Coverage belongs to a source configuration, rather than just a calendar date.
export const gitConfiguration = (repository: Repository, state: Pick<State, 'settings' | 'restoreId'>) =>
    JSON.stringify([repository.path, repository.remote, repository.emails, state.restoreId])
export const contributionConfiguration = (repository: Repository, _state: Pick<State, 'settings' | 'restoreId'>) =>
    remoteConfiguration(repository)
