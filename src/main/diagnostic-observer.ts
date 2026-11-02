import { Context } from 'effect'
import type { DiagnosticObservation } from '../shared/diagnostics'

export interface DiagnosticObserver {
    observe(event: DiagnosticObservation): void
    failure(operation: string, error?: unknown): void
}
export class Diagnostics extends Context.Reference<Diagnostics>()('gitorian/Diagnostics', {
    defaultValue: (): DiagnosticObserver => ({ observe: () => undefined, failure: () => undefined })
}) {}
