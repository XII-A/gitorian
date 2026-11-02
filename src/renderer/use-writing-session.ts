import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import type { Command, Reply, State } from '../shared/model'
import { WritingSession } from './writing-session'
import { registerUpdateCheckpoint } from './update-checkpoint'

export function useWritingSession({
    state,
    week,
    run,
    currentRestoreId
}: {
    state: State
    week: string
    run: (command: Command) => Promise<Reply | undefined>
    currentRestoreId: () => string | undefined
}) {
    const adapters = useRef({ run, currentRestoreId })
    adapters.current = { run, currentRestoreId }
    const [session] = useState(
        () =>
            new WritingSession({
                week,
                restoreId: state.restoreId,
                run: (command) => adapters.current.run(command),
                currentRestoreId: () => adapters.current.currentRestoreId(),
                recovery: {
                    getItem: (key) => localStorage.getItem(key),
                    setItem: (key, value) => localStorage.setItem(key, value),
                    removeItem: (key) => localStorage.removeItem(key)
                }
            })
    )
    const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
    useEffect(() => {
        session.attach()
        const unregister = registerUpdateCheckpoint(() => {
            let preparation!: Promise<() => void>
            flushSync(() => {
                preparation = session.prepareUpdate()
            })
            return preparation
        })
        window.addEventListener('pagehide', session.checkpoint)
        return () => {
            unregister()
            window.removeEventListener('pagehide', session.checkpoint)
            session.detach()
        }
    }, [session])
    useEffect(() => {
        session.observe(state)
    }, [session, state])
    return { session, view }
}
