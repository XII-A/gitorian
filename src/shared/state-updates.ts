import type { Reply, State } from './model'

export const recordCollections = ['repositories', 'activities', 'drafts', 'entries', 'revisions', 'saves'] as const
const collections = recordCollections
type Collection = (typeof collections)[number]
type RecordValue = State[Collection][number]
export interface StateCursor {
    snapshotVersion: number
    restoreId?: string
}
interface RecordUpdates {
    upsert: RecordValue[]
    remove: string[]
    order?: string[]
}
interface StateUpdates {
    base: StateCursor
    values: Partial<Omit<State, Collection>>
    removed: (keyof State)[]
    records: Partial<Record<Collection, RecordUpdates>>
}
export type UpdateReply = Reply | (Omit<Reply, 'state'> & { stateUpdates: StateUpdates })
export const stateCursor = (state: State): StateCursor | undefined =>
    state.snapshotVersion === undefined
        ? undefined
        : { snapshotVersion: state.snapshotVersion, restoreId: state.restoreId }

function matches(state: State, cursor: StateCursor) {
    return state.snapshotVersion === cursor.snapshotVersion && state.restoreId === cursor.restoreId
}

/** Bounded baselines allow concurrent commands and independent desktop windows to request changes. */
export class ReplyUpdates {
    private snapshots = new Map<number, State>()
    private restoreId: string | undefined
    private ambiguous = new Set<number>()

    pack(reply: Reply, base?: StateCursor): UpdateReply {
        const next = reply.state
        if (this.restoreId !== next.restoreId) {
            this.snapshots.clear()
            this.ambiguous.clear()
            this.restoreId = next.restoreId
        }
        const existing = next.snapshotVersion === undefined ? undefined : this.snapshots.get(next.snapshotVersion)
        if (existing && existing !== next && next.snapshotVersion !== undefined) {
            this.snapshots.delete(next.snapshotVersion)
            this.ambiguous.add(next.snapshotVersion)
            if (this.ambiguous.size > 8) this.ambiguous.delete(this.ambiguous.values().next().value!)
        }
        const previous =
            base && base.restoreId === next.restoreId ? this.snapshots.get(base.snapshotVersion) : undefined
        if (next.snapshotVersion !== undefined && !this.ambiguous.has(next.snapshotVersion)) {
            this.snapshots.set(next.snapshotVersion, next)
            if (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value!)
        }
        if (!previous || !base || next.snapshotVersion === undefined) return reply
        const updates: StateUpdates = { base, values: {}, removed: [], records: {} }
        for (const key of Object.keys(next) as (keyof State)[]) {
            if ((collections as readonly string[]).includes(key) || Object.is(previous[key], next[key])) continue
            Object.assign(updates.values, { [key]: next[key] })
        }
        for (const key of Object.keys(previous) as (keyof State)[]) {
            if (!Object.hasOwn(next, key)) updates.removed.push(key)
        }
        for (const key of collections) {
            if (previous[key] === next[key]) continue
            const before = new Map<string, RecordValue>(previous[key].map((item) => [item.id, item]))
            const after = new Set(next[key].map((item) => item.id))
            const upsert = next[key].filter((item) => before.get(item.id) !== item)
            const remove = previous[key].filter((item) => !after.has(item.id)).map((item) => item.id)
            const sameOrder =
                previous[key].length === next[key].length &&
                previous[key].every((item, index) => item.id === next[key][index].id)
            updates.records[key] = { upsert, remove, ...(sameOrder ? {} : { order: next[key].map((item) => item.id) }) }
        }
        const { state: _state, ...extra } = reply
        return { ...extra, stateUpdates: updates }
    }
}

/** Apply only changed records. Unchanged large activity/branch trees never cross IPC again. */
export function expandReply(reply: UpdateReply, base?: State): Reply {
    if ('state' in reply) return reply
    if (!base || !matches(base, reply.stateUpdates.base)) throw new Error('State update baseline mismatch')
    const { stateUpdates, ...extra } = reply
    const state = { ...base, ...stateUpdates.values }
    for (const key of stateUpdates.removed) Reflect.deleteProperty(state, key)
    for (const key of collections) {
        const changes = stateUpdates.records[key]
        if (!changes) continue
        const records = new Map<string, RecordValue>(base[key].map((item) => [item.id, item]))
        for (const id of changes.remove) records.delete(id)
        for (const item of changes.upsert) records.set(item.id, item)
        const order = changes.order ?? base[key].map((item) => item.id)
        Object.assign(state, {
            [key]: order.map((id) => {
                const record = records.get(id)
                if (!record) throw new Error('Invalid state update record order')
                return record
            })
        })
    }
    return { ...extra, state }
}
