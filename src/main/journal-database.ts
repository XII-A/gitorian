import { DatabaseWorker } from './database/worker-client'
import type { JournalEngine } from './database/engine'
import { DatabaseError, type AcquisitionBatch, type Configuration, type JournalView } from './database/types'
import { validateImage } from './images'
import { imageIdPattern, imageLimits } from '../shared/images'
import { stateSchema } from '../shared/model'
import type { Activity, Destination, Draft, Entry, Repository, Selection, State } from '../shared/model'
import type { JournalImage } from '../shared/images'
import type { ProviderAccount } from '../shared/provider-accounts'
import { upgradeJournalBackup } from '../shared/journal-upgrade'

type Operation = Exclude<keyof JournalEngine, 'close'>
type Result<K extends Operation> = ReturnType<JournalEngine[K]>

/** Committed domain commands and bounded reads. Drizzle/SQL/worker details are private. */
export class JournalDatabase {
    private closing = false
    private reopening?: Promise<void>
    private constructor(
        private readonly path: string,
        private connection: DatabaseWorker
    ) {}
    static async open(path: string) {
        return new JournalDatabase(path, await DatabaseWorker.open(path, import.meta.url))
    }
    get config(): Configuration {
        return this.connection.config
    }
    get generation(): string {
        return this.connection.generation
    }
    private async request<K extends Operation>(
        operation: K,
        ...args: Parameters<JournalEngine[K]>
    ): Promise<Result<K>> {
        if (this.closing) throw new DatabaseError('storage', 'The journal is closing.')
        if (!this.connection.available) {
            this.reopening ??= (async () => {
                await this.connection.close()
                this.connection = await DatabaseWorker.open(this.path, import.meta.url)
            })().finally(() => {
                this.reopening = undefined
            })
            await this.reopening
        }
        if (this.closing) throw new DatabaseError('storage', 'The journal is closing.')
        return this.connection.request(operation, ...args)
    }
    readWorkspace(view?: JournalView) {
        return this.request('readWorkspace', view)
    }
    activity(id: string) {
        return this.request('activity', id)
    }
    activities(repositoryId?: string, kind?: Activity['kind']) {
        return this.request('listActivities', repositoryId, kind)
    }
    historyProjectionPage(repositoryId: string, after?: string) {
        return this.request('historyProjectionPage', repositoryId, after)
    }
    history(repositoryId: string, includeItems = true) {
        return this.request('history', repositoryId, includeItems)
    }
    revisions(activityId: string) {
        return this.request('activityRevisions', activityId)
    }
    patch(id: string) {
        return this.request('patch', id)
    }
    draft(id: string) {
        return this.request('draft', id)
    }
    draftForWeek(week: string) {
        return this.request('draftForWeek', week)
    }
    publication(id: string) {
        return this.request('publication', id)
    }
    publications() {
        return this.request('listPublications')
    }
    createDraft(week: string, generation = this.generation) {
        return this.request('createDraft', week, generation)
    }
    saveDraft(draft: Draft, expectedVersion: number, generation = this.generation) {
        return this.request('saveDraft', draft, expectedVersion, generation)
    }
    saveRepository(repository: Repository, generation = this.generation) {
        return this.request('saveRepository', repository, generation)
    }
    updateRepositorySettings(repository: Repository, generation = this.generation) {
        return this.request('updateRepositorySettings', repository, generation)
    }
    updateRepositoryLocation(
        location: Parameters<JournalEngine['updateRepositoryLocation']>[0],
        generation = this.generation
    ) {
        return this.request('updateRepositoryLocation', location, generation)
    }
    assignProviderAccount(
        repositoryId: string,
        configuration: string,
        assignment: Parameters<JournalEngine['assignProviderAccount']>[2],
        generation = this.generation
    ) {
        return this.request('assignProviderAccount', repositoryId, configuration, assignment, generation)
    }
    prepareProviderAccount(account: ProviderAccount, generation = this.generation) {
        return this.request('prepareProviderAccount', account, generation)
    }
    activateProviderAccount(id: string, expected: number, generation = this.generation) {
        return this.request('activateProviderAccount', id, expected, generation)
    }
    finishProviderAccount(id: string, generation = this.generation) {
        return this.request('finishProviderAccount', id, generation)
    }
    finishCredentialCleanup(key: string, generation = this.generation) {
        return this.request('finishCredentialCleanup', key, generation)
    }
    disconnectProviderAccount(
        id: string,
        generation = this.generation,
        status: 'disconnected' | 'reconnect' = 'disconnected'
    ) {
        return this.request('disconnectProviderAccount', id, generation, status)
    }
    saveSettings(settings: State['settings'], generation = this.generation) {
        return this.request('saveSettings', settings, generation)
    }
    setDestination(destination: Destination | undefined, generation = this.generation) {
        return this.request('setDestination', destination, generation)
    }
    saveProgress(progress: Parameters<JournalEngine['saveProgress']>[0], generation = this.generation) {
        return this.request('saveProgress', progress, generation)
    }
    savePause(scope: string, until: number) {
        return this.request('savePause', scope, until)
    }
    acquisitionCheckpoint(key: string) {
        return this.request('acquisitionCheckpoint', key)
    }
    saveCheckpoint(key: string, value: NonNullable<State['acquisition']>[string], generation = this.generation) {
        return this.request('saveCheckpoint', key, value, generation)
    }
    applyAcquisitionBatch(batch: AcquisitionBatch, generation = this.generation) {
        return this.request('applyAcquisitionBatch', batch, generation)
    }
    extendTrackingStart(id: string, since: string, generation = this.generation) {
        return this.request('extendTrackingStart', id, since, generation)
    }
    recordActivityDetails(
        activity: Activity,
        diff?: string,
        revision?: State['revisions'][number],
        generation = this.generation
    ) {
        return this.request('recordActivityDetails', activity, diff, revision, generation)
    }
    setSelection(draftId: string, selection: Selection, included: boolean, generation = this.generation) {
        return this.request('setSelection', draftId, selection, included, generation)
    }
    setDisposition(
        id: string,
        disposition: Activity['disposition'],
        until?: string,
        reason?: string,
        generation = this.generation
    ) {
        return this.request('setDisposition', id, disposition, until, reason, generation)
    }
    setCoverage(selection: Selection, entryId: string, linked: boolean, generation = this.generation) {
        return this.request('setCoverage', selection, entryId, linked, generation)
    }
    beginPublication(draftId: string, generation = this.generation) {
        return this.request('beginPublication', draftId, generation)
    }
    checkpointPublication(save: State['saves'][number], generation = this.generation) {
        return this.request('checkpointPublication', save, generation)
    }
    recordPublicationOutcome(id: string, status: 'unknown' | 'failed', error: string, generation = this.generation) {
        return this.request('recordPublicationOutcome', id, status, error, generation)
    }
    confirmPublication(id: string, entry: Entry, generation = this.generation) {
        return this.request('confirmPublication', id, entry, generation)
    }
    entry(id: string) {
        return this.request('entry', id)
    }
    updateActivityDate(id: string, date: string, sourceVersion: string | undefined, generation = this.generation) {
        return this.request('updateActivityDate', id, date, sourceVersion, generation)
    }
    entryHistory(query: string, cursor?: { date: string; id: string }) {
        return this.request('entryHistory', query, cursor)
    }
    repositoryUnavailable(id: string, configuration: string, generation = this.generation) {
        return this.request('repositoryUnavailable', id, configuration, generation)
    }
    refreshEntry(entry: Entry, generation = this.generation) {
        return this.request('refreshEntry', entry, generation)
    }
    image(id: string) {
        return imageIdPattern.test(id) ? this.request('image', id) : Promise.resolve(undefined)
    }
    async hasImage(id: string) {
        return !!(await this.image(id))
    }
    collectCaches() {
        return this.request('collectCaches')
    }
    async importImage(bytes: Uint8Array, generation = this.generation) {
        return this.request('importImage', await validateImage(bytes), generation)
    }
    export() {
        return this.request('exportJournal')
    }
    async restore(json: string) {
        if (Buffer.byteLength(json) > imageLimits.backup)
            throw new DatabaseError('invalid', 'The backup exceeds the 512 MiB limit.')
        const input = JSON.parse(json) as { backupVersion: number; state: unknown; images: Record<string, unknown>[] }
        if (![3, 4].includes(input.backupVersion) || !Array.isArray(input.images))
            throw new DatabaseError('invalid', 'Unsupported journal backup format')
        const state = stateSchema.parse(input.backupVersion === 3 ? upgradeJournalBackup(input.state) : input.state)
        const images: JournalImage[] = [],
            ids = new Set<string>()
        for (const value of input.images) {
            if (
                typeof value.bytes !== 'string' ||
                value.bytes.length > Math.ceil(imageLimits.bytes / 3) * 4 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bytes)
            )
                throw new DatabaseError('invalid', 'Invalid backup image bytes')
            const image = await validateImage(Buffer.from(value.bytes, 'base64'))
            if (
                image.id !== value.id ||
                image.mime !== value.mime ||
                image.width !== value.width ||
                image.height !== value.height ||
                ids.has(image.id)
            )
                throw new DatabaseError('invalid', 'Invalid backup image')
            ids.add(image.id)
            images.push(image)
        }
        return this.request('restore', state, images)
    }
    async close() {
        if (this.closing) return
        this.closing = true
        await this.reopening
        await this.connection.close()
    }
}
