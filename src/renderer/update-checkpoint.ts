// One mounted writer per renderer. The main process collects all renderers before
// update/quit; local navigation uses this same durability checkpoint.
let checkpoint: (() => Promise<() => void>) | undefined

export function registerUpdateCheckpoint(prepare: () => Promise<() => void>): () => void {
    checkpoint = prepare
    return () => {
        if (checkpoint === prepare) checkpoint = undefined
    }
}

export async function checkpointBeforeUpdate(): Promise<() => void> {
    return checkpoint
        ? checkpoint()
        : () => {
              // The hub has no mounted writing to checkpoint.
          }
}
