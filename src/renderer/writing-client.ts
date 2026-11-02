import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab'
import { EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Step } from '@tiptap/pm/transform'
import type { Schema } from '@tiptap/pm/model'
import type { WritingBridge, WritingState } from '../shared/writing'
import { writingBatch, writingLimits, writingSize } from '../shared/writing'
import type { JournalNode } from '../shared/model'

const prefix = 'gitorian:writing:v1:'
interface Recovery {
    client: string
    base: WritingState
    steps: unknown[]
}
export class WritingClient {
    readonly plugin
    readonly admission: Plugin<number>
    rejectedWriting?: JournalNode
    readonly initial
    private target?: { state: () => EditorState; dispatch: (tr: Transaction) => void }
    private inflight?: Promise<void>
    private timer?: ReturnType<typeof setTimeout>
    private unsubscribe: () => void
    private recoveryTimer?: ReturnType<typeof setTimeout>
    private disposed = false
    private base: WritingState
    readonly key: string
    private constructor(
        private readonly bridge: WritingBridge,
        schema: Schema,
        state: WritingState,
        readonly client: string,
        private readonly report: (status: string) => void
    ) {
        this.base = state
        this.initial = schema.nodeFromJSON(this.base.document)
        this.plugin = collab({ version: this.base.version, clientID: client })
        const key = new PluginKey<number>('writingAdmission')
        const estimate = (tr: Transaction, previous: number) =>
            previous + tr.steps.reduce((size, step) => size + writingSize(step.toJSON()), 0)
        this.admission = new Plugin({
            key,
            state: {
                init: (_, state) => writingSize(state.doc.toJSON()),
                apply: (tr, previous) => {
                    if (!tr.docChanged) return previous
                    const upper = estimate(tr, previous)
                    return upper > writingLimits.documentBytes ? writingSize(tr.doc.toJSON()) : upper
                }
            },
            filterTransaction: (tr, state) => {
                if (!tr.docChanged) return true
                const tooLarge = tr.steps.some((step) => writingSize([step.toJSON()]) > writingLimits.updateBytes)
                const upper = estimate(tr, key.getState(state) ?? writingSize(state.doc.toJSON()))
                if (
                    !tooLarge &&
                    (upper <= writingLimits.documentBytes ||
                        writingSize(tr.doc.toJSON()) <= writingLimits.documentBytes)
                )
                    return true
                this.rejectedWriting = tr.doc.toJSON()
                this.report(
                    'Could not add this edit. It exceeds the writing size limit. Download the rejected copy, then paste smaller sections.'
                )
                return false
            }
        })
        this.key = `${prefix}${state.generation}:${state.draftId}:${state.field}:${client}`
        window.addEventListener('pagehide', this.pagehide)
        this.unsubscribe = bridge.onChange((next) => this.receive(next))
        // Opening returns the full committed history, so updates racing with
        // subscription are covered when attach performs its explicit catch-up.
    }
    static async open(
        bridge: WritingBridge,
        schema: Schema,
        draftId: string,
        generation: string,
        field: 'body' | 'title',
        report: (status: string) => void
    ) {
        const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
        for (const key of keys) {
            if (!key.startsWith(`${prefix}${generation}:${draftId}:${field}:`)) continue
            const client = key.slice(`${prefix}${generation}:${draftId}:${field}:`.length)
            if (!(await bridge.claim(client))) continue
            try {
                // The former owner may have checkpointed again before releasing
                // its lease. Only the record read under our claim is authoritative.
                const raw = localStorage.getItem(key)
                if (!raw) continue
                const value = JSON.parse(raw) as Recovery
                if (
                    value.client !== client ||
                    value.base.draftId !== draftId ||
                    value.base.generation !== generation ||
                    value.base.field !== field
                )
                    throw new Error('Recovery does not belong to this writing session')
                let state = EditorState.create({
                    schema,
                    doc: schema.nodeFromJSON(value.base.document),
                    plugins: [collab({ version: value.base.version, clientID: value.client })]
                })
                const tr = state.tr
                for (const json of value.steps) tr.step(Step.fromJSON(schema, json))
                state = state.apply(tr)
                do {
                    const pending = sendableSteps(state)
                    const next = await bridge.submit({
                        draftId,
                        generation,
                        field,
                        version: getVersion(state),
                        client: value.client,
                        steps: writingBatch(pending?.steps.map((s) => s.toJSON()) ?? [])
                    })
                    state = state.apply(
                        receiveTransaction(
                            state,
                            next.steps.slice(getVersion(state) - next.fromVersion).map((s) => Step.fromJSON(schema, s)),
                            next.clients.slice(getVersion(state) - next.fromVersion)
                        )
                    )
                    const remaining = sendableSteps(state)
                    if (remaining)
                        localStorage.setItem(
                            key,
                            JSON.stringify({
                                client: value.client,
                                base: next,
                                steps: remaining.steps.map((s) => s.toJSON())
                            })
                        )
                } while (sendableSteps(state))
                localStorage.removeItem(key)
            } finally {
                await bridge.release(client)
            }
        }
        const client = crypto.randomUUID()
        if (!(await bridge.claim(client))) throw new Error('Writing session is already open')
        try {
            const state = await bridge.open(draftId, generation, field)
            return new WritingClient(bridge, schema, state, client, report)
        } catch (error) {
            await bridge.release(client)
            throw error
        }
    }
    private pagehide = () => {
        try {
            this.cache()
        } catch {
            /* Keep the in-memory copy and show the storage error. */
        }
    }
    attach(target: { state: () => EditorState; dispatch: (tr: Transaction) => void }) {
        this.target = target
        void this.flush().catch(() => {
            /* The writing status reports the failure. */
        })
    }
    changed() {
        if (this.disposed || !this.target || !sendableSteps(this.target.state())) return
        this.report('Saving…')
        // Timers are bounded from the first edit, rather than reset by continuous typing.
        this.recoveryTimer ??= setTimeout(() => {
            this.recoveryTimer = undefined
            try {
                this.cache()
            } catch {
                /* status reports recovery failure */
            }
        }, 100)
        this.timer ??= setTimeout(() => {
            this.timer = undefined
            void this.flush().catch(() => {
                /* The writing status reports the failure. */
            })
        }, 40)
    }
    cache() {
        if (!this.target) return
        const pending = sendableSteps(this.target.state())
        try {
            if (pending)
                localStorage.setItem(
                    this.key,
                    JSON.stringify({
                        client: this.client,
                        base: { ...this.base, steps: [], clients: [], fromVersion: this.base.version },
                        steps: pending.steps.map((s) => s.toJSON())
                    })
                )
            else localStorage.removeItem(this.key)
        } catch {
            this.report('Recovery storage unavailable. Keep this window open and retry saving.')
            throw new Error('Recovery storage unavailable')
        }
    }
    private receive(next: WritingState) {
        if (
            !this.target ||
            this.disposed ||
            next.draftId !== this.base.draftId ||
            next.field !== this.base.field ||
            next.generation !== this.base.generation
        )
            return
        const state = this.target.state()
        const version = getVersion(state)
        if (next.version < version) return
        if (next.fromVersion > version) {
            void this.flush().catch(() => {
                /* Request the missing committed prefix. */
            })
            return
        }
        // NodeType identities belong to the mounted editor's Schema instance.
        // Structurally equal worker/schema definitions are not interchangeable.
        const steps = next.steps.slice(version - next.fromVersion).map((s) => Step.fromJSON(state.schema, s))
        if (steps.length)
            this.target.dispatch(
                receiveTransaction(state, steps, next.clients.slice(version - next.fromVersion), {
                    mapSelectionBackward: true
                })
            )
        this.base = next
        try {
            this.cache()
        } catch {
            /* Durable acknowledgement still permits saving without recovery storage. */
        }
        this.report(sendableSteps(this.target.state()) ? 'Saving…' : 'Saved on this device')
    }
    async flush(): Promise<void> {
        if (!this.target || this.disposed) return
        if (this.inflight) {
            await this.inflight
            return this.flush()
        }
        clearTimeout(this.timer)
        this.timer = undefined
        const run = async () => {
            do {
                try {
                    this.cache()
                } catch {
                    /* Attempt durable storage even when recovery storage is full. */
                }
                const state = this.target!.state()
                const pending = sendableSteps(state)
                const next = await this.bridge.submit({
                    draftId: this.base.draftId,
                    generation: this.base.generation,
                    field: this.base.field,
                    version: getVersion(state),
                    client: this.client,
                    steps: writingBatch(pending?.steps.map((s) => s.toJSON()) ?? [])
                })
                this.receive(next)
            } while (!this.disposed && sendableSteps(this.target!.state()))
        }
        this.inflight = run()
            .catch((error: unknown) => {
                this.report('Could not save writing. Retry before closing.')
                throw error
            })
            .finally(() => {
                this.inflight = undefined
            })
        return this.inflight
    }
    dispose() {
        if (this.disposed) return
        try {
            this.cache()
        } catch {
            /* Preserve existing recovery when storage is unavailable. */
        }
        clearTimeout(this.timer)
        clearTimeout(this.recoveryTimer)
        window.removeEventListener('pagehide', this.pagehide)
        this.unsubscribe()
        this.disposed = true
        void this.bridge.release(this.client).catch(() => {
            /* The window owner also releases destroyed sessions. */
        })
    }
}
