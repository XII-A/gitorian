import { useCallback, useSyncExternalStore } from 'react'

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
const publish = () => {
    now = Date.now()
    for (const listener of listeners) {
        listener()
    }
}
const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (!timer) {
        publish()
        timer = setInterval(publish, 60_000)
    }
    return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
            clearInterval(timer)
            timer = undefined
        }
    }
}
const snapshot = () => now
export const useNow = (serverTime = 0) => {
    const serverSnapshot = useCallback(() => serverTime, [serverTime])
    return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
