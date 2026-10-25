import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Download } from 'lucide-react'
import type { AppUpdateState } from '../shared/app-updates'
import { checkpointBeforeUpdate } from './update-checkpoint'
import { Button } from './components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { useToastStack } from './components/arc/toast-stack/toast-stack'
import './app-updates.css'

const unavailable: AppUpdateState = { status: 'unavailable' }
let state: AppUpdateState = unavailable
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | undefined
let installing = false
let resumeWriting: (() => void) | undefined

function receive(next: AppUpdateState) {
    if (next.status !== 'installing') {
        resumeWriting?.()
        resumeWriting = undefined
    }
    state = next
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    if (listeners.size === 1 && window.journal?.appUpdates) {
        let changed = false
        unsubscribe = window.journal.appUpdates.onState((next) => {
            changed = true
            receive(next)
        })
        void window.journal.appUpdates
            .state()
            .then((next) => {
                if (!changed) receive(next)
            })
            .catch(() => {
                // Detached read-only windows have no update controls.
            })
    }
    return () => {
        listeners.delete(listener)
        if (!listeners.size) {
            unsubscribe?.()
            unsubscribe = undefined
        }
    }
}

function useAppUpdateState() {
    return useSyncExternalStore(
        subscribe,
        () => state,
        () => unavailable
    )
}

async function installUpdate() {
    if (installing || state.status !== 'ready' || !window.journal.appUpdates) return
    installing = true
    try {
        if (document.querySelector('.settings')) throw new Error('Save or close Settings, then try updating again.')
        resumeWriting = await checkpointBeforeUpdate()
        receive({ status: 'installing', version: state.version })
        const result = await window.journal.appUpdates.install()
        receive(result)
    } catch (error) {
        const version = 'version' in state ? state.version : ''
        receive({
            status: 'ready',
            version,
            error: error instanceof Error ? error.message : 'Could not prepare the update. Try again.'
        })
    } finally {
        installing = false
    }
}

export function AppUpdateNotifications() {
    const update = useAppUpdateState()
    const { toast, dismiss } = useToastStack()
    const prompted = useRef('')
    useEffect(() => {
        if (update.status !== 'ready') {
            dismiss('app-update-ready')
            return
        }
        if (update.error) {
            toast({ id: 'app-update-error', type: 'error', title: 'Update paused', description: update.error })
            return
        }
        if (prompted.current === update.version) return
        prompted.current = update.version
        try {
            if (localStorage.getItem('gitorian:update-prompt') === update.version) return
            localStorage.setItem('gitorian:update-prompt', update.version)
        } catch {
            // The mounted notification owner still prompts at most once per version.
        }
        toast({
            id: 'app-update-ready',
            type: 'info',
            title: `Gitorian ${update.version} is ready`,
            description: 'Update now to restart, or keep writing and update later from the header.',
            duration: Infinity,
            action: { label: 'Update now', onClick: () => void installUpdate() }
        })
    }, [update, toast, dismiss])
    return null
}

export function AppUpdateButton() {
    const update = useAppUpdateState()
    if (update.status !== 'ready') return null
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Update ready"
                    title="Update ready"
                    className="app-update-trigger"
                    animateContent={false}
                >
                    <span className="app-update-icon" aria-hidden="true">
                        <Download size={16} />
                        <span className="app-update-dot" />
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="app-update-popover" aria-label="App updates">
                <h2>Ready to update</h2>
                <p>Gitorian {update.version} is ready. Your writing will be saved before the app restarts.</p>
                {update.error && <p role="alert">{update.error}</p>}
                <Button size="sm" animateContent={false} onClick={() => void installUpdate()}>
                    Update now
                </Button>
            </PopoverContent>
        </Popover>
    )
}
