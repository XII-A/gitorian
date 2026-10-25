// One editable weekly draft is mounted in the main window. Keep its update
// checkpoint independent of progress subscriptions so downloads never rerender it.
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
