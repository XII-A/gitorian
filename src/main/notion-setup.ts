import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { Schema } from 'effect'
import type { JournalSetup } from './notion-connection'

export interface JournalSetupStore {
    get(workspace: string): JournalSetup | undefined
    set(workspace: string, setup: JournalSetup): void
    clear(workspace: string): void
}
const records = Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
        id: Schema.NonEmptyString,
        started: Schema.Boolean,
        title: Schema.optional(Schema.NonEmptyString),
        pageId: Schema.optional(Schema.NonEmptyString)
    })
})

/** Durable recovery metadata, independent of whether OS credential encryption is available. */
export class NotionSetupStore implements JournalSetupStore {
    constructor(private readonly path: string) {}
    private read(): Record<string, JournalSetup> {
        if (!existsSync(this.path)) return {}
        // Invalid recovery must stop setup, never silently permit a duplicate creation.
        return Schema.decodeUnknownSync(records)(JSON.parse(readFileSync(this.path, 'utf8')))
    }
    get(workspace: string): JournalSetup | undefined {
        return this.read()[workspace]
    }
    private write(value: Record<string, JournalSetup>): void {
        const next = `${this.path}.next`
        const descriptor = openSync(next, 'w', 0o600)
        try {
            writeFileSync(descriptor, JSON.stringify(value))
            fsyncSync(descriptor)
        } finally {
            closeSync(descriptor)
        }
        renameSync(next, this.path)
    }
    set(workspace: string, setup: JournalSetup): void {
        // Explicit fields keep credentials out even when a caller supplies a richer object.
        const { id, started, title, pageId } = setup
        this.write({ ...this.read(), [workspace]: { id, started, title, pageId } })
    }
    clear(workspace: string): void {
        const value = this.read()
        this.write(Object.fromEntries(Object.entries(value).filter(([key]) => key !== workspace)))
    }
}
