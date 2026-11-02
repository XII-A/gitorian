export interface DiagnosticState {
    recovery: boolean
    available: boolean
    liveRecovery: boolean
    startupFailed?: boolean
    restartRequired?: boolean
}
export type DiagnosticAction = 'copy' | 'save' | 'continue' | 'restart'
export interface DiagnosticObservation {
    type: 'operation' | 'failure' | 'health' | 'source'
    operation: string
    phase: 'begin' | 'end' | 'failed' | 'stalled' | 'responsive'
    frames?: string[]
    operationId?: string
    durationMs?: number
}
export interface DiagnosticsBridge {
    onRestart?(listener: () => Promise<void>): () => void
    onState?(listener: (state: DiagnosticState) => void): () => void
    state(): Promise<DiagnosticState>
    act(action: DiagnosticAction): Promise<boolean>
    error(kind: 'render' | 'promise'): void
}
