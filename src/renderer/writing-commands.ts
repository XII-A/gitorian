const selections = new Map<string, Promise<boolean>>()
export function beginWritingSelection(key: string) {
    let finish!: (success: boolean) => void
    selections.set(
        key,
        new Promise((resolve) => {
            finish = resolve
        })
    )
    return finish
}
export async function settleWritingSelections() {
    const pending = [...selections.entries()]
    const results = await Promise.all(pending.map(([, value]) => value))
    if (results.some((success) => !success))
        throw new Error('Retry the failed activity selection before publishing or closing.')
    for (const [key, value] of pending) if (selections.get(key) === value) selections.delete(key)
}
