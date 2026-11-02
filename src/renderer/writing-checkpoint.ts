// One editable weekly draft is mounted in the main window. Updates and recovery share its save protocol.
let checkpoint: (() => Promise<() => void>) | undefined

export function registerWritingCheckpoint(prepare: () => Promise<() => void>): () => void {
    checkpoint = prepare
    return () => {
        if (checkpoint === prepare) checkpoint = undefined
    }
}

export async function checkpointWriting(): Promise<() => void> {
    return checkpoint
        ? checkpoint()
        : () => {
              // The hub has no mounted writing to checkpoint.
          }
}
