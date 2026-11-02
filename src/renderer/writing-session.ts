import { draftSchema, type Command, type Draft, type Reply, type State } from '../shared/model'
import { journalWordCount, type EditorSnapshot } from './editor-snapshot'

type WritingCommand = Extract<Command, { type: 'draft' | 'newDraft' | 'state' | 'publish' | 'reconcile' }>
type Source = Pick<State, 'restoreId' | 'snapshotVersion' | 'drafts' | 'saves'>
type SaveOutcome = 'saved' | 'failed' | 'conflict' | 'retired'
interface Conflict {
    saved: Draft
    recovery: Draft
}
interface WritingView {
    readonly draft?: Draft
    readonly status: 'empty' | 'saving' | 'saved' | 'recovered' | 'published' | 'updated'
    readonly words: number
    readonly busy: boolean
    readonly imagesReady: boolean
    readonly saveIssue?: { kind: 'save' | 'recovery' }
    readonly conflict?: Conflict
    readonly conflictError: string
    readonly resolvingConflict: boolean
    readonly publication?: State['saves'][number]
}
interface Options {
    week: string
    restoreId?: string
    currentRestoreId: () => string | undefined
    run: (command: WritingCommand) => Promise<Reply | undefined>
    recovery: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

export class WritingSession {
    private view: WritingView = {
        status: 'empty',
        words: 0,
        busy: false,
        imagesReady: true,
        conflictError: '',
        resolvingConflict: false
    }
    private listeners = new Set<() => void>()
    private attached = false
    private epoch = 0
    private latest?: Draft
    private body?: EditorSnapshot
    private revision = 0
    private savedRevision = 0
    private pending?: Promise<SaveOutcome>
    private operation?: symbol
    private idle?: ReturnType<typeof setTimeout>
    private periodic?: ReturnType<typeof setTimeout>
    private wordTimer?: ReturnType<typeof setTimeout>
    private ownedRecovery?: string
    private readonly storageKey: string

    constructor(private readonly options: Options) {
        this.storageKey = `gitorian:recovery:${options.restoreId ?? 'local'}:${options.week}`
    }
    getSnapshot = (): WritingView => this.view
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }
    private show(change: Partial<WritingView>) {
        if (Object.entries(change).every(([key, value]) => this.view[key as keyof WritingView] === value)) return
        this.view = { ...this.view, ...change }
        if (this.attached) for (const listener of this.listeners) listener()
    }
    private live() {
        return this.attached && this.options.currentRestoreId() === this.options.restoreId
    }
    private dirty() {
        return this.revision !== this.savedRevision
    }
    attach() {
        this.attached = true
        this.epoch++
        if (this.dirty()) this.checkpoint()
    }
    detach() {
        this.checkpoint()
        this.attached = false
        this.epoch++
        this.cancelSaveTimers()
        clearTimeout(this.wordTimer)
        this.wordTimer = undefined
    }
    private cancelSaveTimers() {
        clearTimeout(this.idle)
        clearTimeout(this.periodic)
        this.idle = undefined
        this.periodic = undefined
    }
    private materialize(): Draft | undefined {
        if (this.body && this.latest) {
            this.latest = { ...this.latest, body: this.body.read() }
            this.body = undefined
        }
        return this.latest
    }
    private cache() {
        if (!this.view.conflict && !this.dirty()) return
        const writing = this.view.conflict?.recovery ?? this.materialize()
        if (!writing) return
        try {
            const raw = JSON.stringify(writing)
            this.options.recovery.setItem(this.storageKey, raw)
            this.ownedRecovery = raw
        } catch {
            if (this.view.saveIssue?.kind !== 'save') this.show({ saveIssue: { kind: 'recovery' } })
        }
    }
    private clearRecovery() {
        if (
            this.live() &&
            this.ownedRecovery !== undefined &&
            this.options.recovery.getItem(this.storageKey) === this.ownedRecovery
        ) {
            this.options.recovery.removeItem(this.storageKey)
            this.ownedRecovery = undefined
        }
    }
    checkpoint = () => {
        this.cancelSaveTimers()
        this.cache()
        if (!this.live() || this.operation) return
        const epoch = this.epoch
        if (this.pending)
            void this.pending.then((outcome) => {
                if (outcome === 'saved' && this.live() && this.epoch === epoch && !this.operation) void this.persist()
            })
        else void this.persist()
    }
    observe(source: Source) {
        if (!this.live() || source.restoreId !== this.options.restoreId) return
        const drafts = source.drafts.filter((item) => item.week === this.options.week)
        const first = drafts.at(-1)
        if (!this.latest && first) this.open(first)
        const confirmed = drafts.find((item) => item.id === this.latest?.id && item.publishedEntryId)
        if (confirmed && this.latest && !this.latest.publishedEntryId) {
            this.latest = { ...this.latest, publishedEntryId: confirmed.publishedEntryId }
            this.show({ draft: { ...this.view.draft!, publishedEntryId: confirmed.publishedEntryId } })
        }
        const publication = source.saves.filter((save) => save.draftId === this.latest?.id).at(-1)
        this.show({ publication })
    }
    private replace(draft: Draft, status: WritingView['status'] = 'saved') {
        this.latest = draft
        this.body = undefined
        this.show({ draft, words: journalWordCount(draft.body), status })
    }
    private showConflict(saved: Draft, recovery: Draft) {
        this.cancelSaveTimers()
        this.show({ conflict: { saved, recovery }, conflictError: '', saveIssue: undefined })
        this.cache()
    }
    private open(item: Draft) {
        let recovered = item
        try {
            const raw = this.options.recovery.getItem(this.storageKey)
            const parsed = raw ? draftSchema.safeParse(JSON.parse(raw)) : undefined
            if (parsed?.success && parsed.data.id === item.id) {
                this.ownedRecovery = raw ?? undefined
                const copy = parsed.data
                const differs = copy.title !== item.title || JSON.stringify(copy.body) !== JSON.stringify(item.body)
                if (differs && copy.version !== item.version) this.showConflict(item, copy)
                else if (differs && copy.updatedAt > item.updatedAt) {
                    recovered = { ...copy, publishedEntryId: item.publishedEntryId }
                    this.revision++
                } else if (!differs) this.clearRecovery()
            }
        } catch {
            /* Saved writing remains usable without recovery storage. */
        }
        this.replace(recovered, this.dirty() ? 'recovered' : 'saved')
        if (this.dirty()) void this.persist()
    }
    edit = (change: { title: string } | { body: EditorSnapshot }) => {
        if (!this.live() || !this.latest || this.operation || this.view.conflict) return
        this.revision++
        this.latest = {
            ...this.latest,
            updatedAt: new Date().toISOString(),
            ...('title' in change ? { title: change.title } : {})
        }
        if ('body' in change) {
            this.body = change.body
            if (!this.wordTimer)
                this.wordTimer = setTimeout(() => {
                    this.wordTimer = undefined
                    this.show({ words: this.body ? this.body.wordCount() : journalWordCount(this.latest!.body) })
                }, 200)
        }
        this.show({
            status: 'saving',
            ...('title' in change ? { draft: { ...this.view.draft!, title: change.title } } : {})
        })
        clearTimeout(this.idle)
        this.idle = setTimeout(this.checkpoint, 1000)
        if (!this.periodic) this.periodic = setTimeout(this.checkpoint, 5000)
    }
    retrySave = async (): Promise<SaveOutcome> => {
        this.cache()
        return this.persist()
    }
    private async persist(): Promise<SaveOutcome> {
        if (this.pending) return this.pending
        if (!this.live()) return 'retired'
        if (this.view.conflict) return 'conflict'
        if (!this.dirty() || !this.latest) return 'saved'
        const writing = this.materialize()!
        const revision = this.revision
        const request = this.write(writing, revision)
        this.pending = request
        try {
            return await request
        } finally {
            if (this.pending === request) this.pending = undefined
        }
    }
    private async write(writing: Draft, revision: number): Promise<SaveOutcome> {
        let result: Reply | undefined
        try {
            result = await this.options.run({ type: 'draft', draft: writing })
        } catch {
            /* Failed commands retain their local revision for retry. */
        }
        if (this.options.currentRestoreId() !== this.options.restoreId) return 'retired'
        const committed = result?.draftSaved
        if (
            !result ||
            result.state.restoreId !== this.options.restoreId ||
            committed?.id !== writing.id ||
            committed.version !== writing.version + 1
        ) {
            if (!this.live()) return 'retired'
            const saved =
                result && result.state.restoreId === this.options.restoreId
                    ? result.state.drafts.find((item) => item.id === writing.id)
                    : undefined
            if (saved && saved.version !== writing.version) {
                this.showConflict(saved, this.materialize()!)
                return 'conflict'
            }
            this.cache()
            this.show({ status: 'empty', saveIssue: { kind: 'save' } })
            return 'failed'
        }
        this.latest = { ...this.latest!, version: committed.version }
        this.savedRevision = revision
        if (this.live() && !this.dirty()) {
            try {
                this.clearRecovery()
            } catch {
                /* The database acknowledgment is durable even when cache cleanup fails. */
            }
            this.show({ status: 'saved', saveIssue: undefined })
        }
        return 'saved'
    }
    private acquire(): symbol | undefined {
        if (!this.live() || this.operation || this.view.conflict) return
        const token = Symbol()
        this.operation = token
        this.show({ busy: true })
        return token
    }
    private release(token: symbol) {
        if (this.operation !== token) return
        this.operation = undefined
        this.show({ busy: false })
    }
    private async drain(epoch: number): Promise<SaveOutcome> {
        this.cancelSaveTimers()
        this.cache()
        do {
            if (!this.live() || this.epoch !== epoch) return 'retired'
            const outcome = await this.persist()
            if (outcome !== 'saved') return outcome
        } while (this.dirty())
        return this.live() && this.epoch === epoch ? 'saved' : 'retired'
    }
    start = async (): Promise<'created' | 'existing' | 'busy' | 'failed' | 'retired'> => {
        if (this.latest) return 'existing'
        if (!this.live()) return 'retired'
        const token = this.acquire()
        if (!token) return 'busy'
        try {
            const result = await this.options.run({ type: 'newDraft', week: this.options.week })
            if (!this.live()) return 'retired'
            const created =
                result && result.state.restoreId === this.options.restoreId
                    ? result.state.drafts.filter((item) => item.week === this.options.week).at(-1)
                    : undefined
            if (!created) return 'failed'
            this.open(created)
            return 'created'
        } catch {
            return this.live() ? 'failed' : 'retired'
        } finally {
            this.release(token)
        }
    }
    publish = async (): Promise<'published' | 'updated' | 'blocked' | 'failed' | 'unconfirmed' | 'retired'> => {
        if (
            !this.latest ||
            !this.view.imagesReady ||
            ['pending', 'unknown'].includes(this.view.publication?.status ?? '')
        )
            return 'blocked'
        const token = this.acquire()
        if (!token) return 'blocked'
        const epoch = this.epoch
        const updating = !!this.latest.publishedEntryId
        try {
            const saved = await this.drain(epoch)
            if (saved !== 'saved') return saved === 'retired' ? 'retired' : 'blocked'
            const result = await this.options.run({ type: 'publish', draftId: this.latest.id })
            if (!this.live() || epoch !== this.epoch) return 'retired'
            if (!result || result.state.restoreId !== this.options.restoreId) return 'failed'
            this.observe(result.state)
            if (this.latest.publishedEntryId && this.view.publication?.status === 'confirmed') {
                const outcome = updating ? 'updated' : 'published'
                this.show({ status: outcome })
                return outcome
            }
            return this.view.publication ? 'unconfirmed' : 'failed'
        } catch {
            return this.live() && epoch === this.epoch ? 'failed' : 'retired'
        } finally {
            this.release(token)
        }
    }
    prepareUpdate = async (): Promise<() => void> => {
        if (!this.view.imagesReady) throw new Error('Finish or cancel image imports, then try updating again.')
        const token = this.acquire()
        if (!token) throw new Error('Finish the current journal action, then try updating again.')
        try {
            if ((await this.drain(this.epoch)) !== 'saved')
                throw new Error('Could not save your writing. Retry saving before updating.')
            return () => this.release(token)
        } catch (error) {
            this.release(token)
            throw error
        }
    }
    setImagesReady = (imagesReady: boolean) => {
        this.show({ imagesReady })
    }
    verifyPublication = async (saveId: string): Promise<'confirmed' | 'unconfirmed' | 'retired'> => {
        if (!this.live()) return 'retired'
        const epoch = this.epoch
        try {
            const result = await this.options.run({ type: 'reconcile', saveId })
            if (!this.live() || epoch !== this.epoch) return 'retired'
            if (result && result.state.restoreId === this.options.restoreId) {
                this.observe(result.state)
                if (result.state.saves.find((save) => save.id === saveId)?.status === 'confirmed') return 'confirmed'
            }
            return 'unconfirmed'
        } catch {
            return this.live() && epoch === this.epoch ? 'unconfirmed' : 'retired'
        }
    }
    resolveConflict = async (choice: 'saved' | 'recovery'): Promise<void> => {
        const current = this.view.conflict
        if (!current || !this.live() || this.operation) return
        const token = Symbol()
        const epoch = this.epoch
        this.operation = token
        this.show({ resolvingConflict: true, conflictError: '' })
        try {
            const writing = {
                ...current.recovery,
                version: current.saved.version,
                publishedEntryId: current.saved.publishedEntryId
            }
            const result = await this.options.run(
                choice === 'recovery' ? { type: 'draft', draft: writing } : { type: 'state' }
            )
            if (!this.live() || epoch !== this.epoch) return
            const saved = result?.state.drafts.find((item) => item.id === current.saved.id)
            if (!result || result.state.restoreId !== this.options.restoreId || !saved) {
                this.show({
                    conflictError: 'Could not confirm this choice. Both copies are still available. Try again.'
                })
                return
            }
            const acknowledged =
                result.draftSaved?.id === writing.id && result.draftSaved.version === writing.version + 1
            const expected = choice === 'recovery' && acknowledged ? writing.version + 1 : current.saved.version
            if (saved.version !== expected) {
                this.showConflict(saved, current.recovery)
                this.show({ conflictError: 'Saved writing changed again. Choose which copy to keep.' })
                return
            }
            if (choice === 'recovery' && !acknowledged) {
                this.show({
                    conflictError: 'Could not save the recovery copy. Both copies are still available. Try again.'
                })
                return
            }
            this.clearRecovery()
            this.savedRevision = this.revision
            this.replace(saved)
            this.show({ conflict: undefined, saveIssue: undefined })
        } catch {
            if (this.live() && epoch === this.epoch)
                this.show({
                    conflictError: 'Could not finish this choice. Both copies are still available. Try again.'
                })
        } finally {
            this.release(token)
            this.show({ resolvingConflict: false })
        }
    }
}
