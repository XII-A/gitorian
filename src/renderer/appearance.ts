import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { defaultAppearance, resolveAppearance, type Appearance } from '../shared/appearance'
import { themePalette } from '../shared/themes'
import { motionTokens } from './components/arc/motion-tokens'

let preference = defaultAppearance
let desired = defaultAppearance
let resolved: 'light' | 'dark' = 'dark'
let snapshot: { preference: Appearance; resolved: 'light' | 'dark'; error: string } = {
    preference,
    resolved,
    error: ''
}
const listeners = new Set<() => void>()
let active: ViewTransition | undefined
let generation = 0
let pending = 0
let received: Appearance | undefined
let system: MediaQueryList
function publish(error = '') {
    snapshot = { preference, resolved, error }
    for (const listener of listeners) listener()
}
function apply(next: Appearance) {
    preference = next
    resolved = resolveAppearance(next, system.matches)
    document.documentElement.dataset.theme = resolved
    document.documentElement.dataset.accent = next.theme
    document.documentElement.dataset.palette = next.theme
    for (const [token, value] of Object.entries(themePalette(next.theme, resolved)))
        document.documentElement.style.setProperty(token, value)
    publish()
}
export function initializeAppearance() {
    system = matchMedia('(prefers-color-scheme: dark)')
    apply(window.journal.appearance?.initial ?? defaultAppearance)
    desired = preference
    system.addEventListener('change', () => {
        if (preference.mode === 'system') {
            active?.skipTransition()
            apply(preference)
        }
    })
    window.journal.appearance?.onChange((next) => {
        received = next
        if (!pending) {
            active?.skipTransition()
            apply(next)
            desired = next
        }
    })
}
export function useAppearance() {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        () => snapshot
    )
}
export async function selectAppearance(patch: Partial<Appearance>, trigger?: HTMLElement) {
    const next = { ...desired, ...patch }
    if (next.mode === desired.mode && next.theme === desired.theme && !snapshot.error) return
    desired = next
    const request = ++generation
    pending++
    active?.skipTransition()
    try {
        if (!window.journal.appearance) throw new Error('Appearance storage is unavailable')
        const saved = await window.journal.appearance.select(next)
        if (request !== generation) return
        if (!trigger || matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) {
            apply(saved)
            return
        }
        const rect = trigger?.getBoundingClientRect()
        const x = rect ? rect.left + rect.width / 2 : innerWidth / 2
        const y = rect ? rect.top + rect.height / 2 : innerHeight / 2
        // Percentages keep the reveal anchored correctly in Electron at fractional desktop scaling.
        const origin = `${(x / innerWidth) * 100}% ${(y / innerHeight) * 100}%`
        const radius =
            (Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) /
                Math.hypot(innerWidth, innerHeight)) *
            Math.SQRT2 *
            100
        let transition: ViewTransition
        try {
            document.documentElement.dataset.appearanceSwitching = ''
            transition = document.startViewTransition(() => {
                // The incoming snapshot must include the new React control state as well as the palette.
                if (request === generation) flushSync(() => apply(saved))
            })
        } catch {
            delete document.documentElement.dataset.appearanceSwitching
            apply(saved)
            return
        }
        active = transition
        try {
            await transition.ready
            document.documentElement.animate(
                { clipPath: [`circle(0% at ${origin})`, `circle(${radius}% at ${origin})`] },
                {
                    duration: motionTokens.duration.standard * 1000,
                    easing: `cubic-bezier(${motionTokens.ease.enter.join(',')})`,
                    pseudoElement: '::view-transition-new(root)'
                }
            )
            await transition.finished
        } catch {
            if (request === generation) apply(saved)
        } finally {
            if (active === transition) {
                active = undefined
                delete document.documentElement.dataset.appearanceSwitching
            }
        }
    } catch {
        if (request === generation) {
            desired = received ?? preference
            publish('Could not save appearance. Try choosing it again.')
        }
    } finally {
        pending--
        if (!pending && received && (received.mode !== preference.mode || received.theme !== preference.theme)) {
            const error = snapshot.error
            apply(received)
            desired = received
            if (error) publish(error)
        }
    }
}
