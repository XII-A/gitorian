import type { AppUpdater } from 'electron-updater'
import type { AppUpdateState } from '../shared/app-updates'

/** Owns the entire update lifecycle; journal snapshots never carry download progress. */
export class AppUpdates {
    private state: AppUpdateState
    private listeners = new Set<(state: AppUpdateState) => void>()
    private checking = false
    private resume?: () => void

    constructor(
        private updater: AppUpdater | undefined,
        private prepareInstall: () => Promise<() => void>
    ) {
        this.state = { status: updater ? 'idle' : 'unavailable' }
        if (!updater) return
        updater.autoDownload = false
        updater.autoInstallOnAppQuit = false
        updater.allowPrerelease = false
        updater.allowDowngrade = false
        updater.disableWebInstaller = true
        updater.on('download-progress', ({ percent }) => {
            if (this.state.status !== 'downloading') return
            const next = Math.min(100, Math.max(0, Math.floor(percent)))
            if (this.state.percent !== next) this.set({ ...this.state, percent: next })
        })
        updater.on('update-downloaded', ({ version }) => this.set({ status: 'ready', version }))
        updater.on('error', (error) => {
            console.error('App update failed', error)
            if (this.state.status === 'installing') {
                this.resume?.()
                this.resume = undefined
                this.set({
                    status: 'ready',
                    version: this.state.version,
                    error: 'Could not start the installer. Try updating again.'
                })
            }
        })
    }

    snapshot(): AppUpdateState {
        return this.state
    }

    subscribe(listener: (state: AppUpdateState) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    start(): void {
        if (!this.updater) return
        setTimeout(() => void this.check(), 15000).unref()
        setInterval(() => void this.check(), 6 * 60 * 60 * 1000).unref()
    }

    async check(): Promise<void> {
        const updater = this.updater
        if (!updater || this.checking || ['ready', 'installing'].includes(this.state.status)) return
        this.checking = true
        this.set({ status: 'checking' })
        let downloading = false
        try {
            const result = await updater.checkForUpdates()
            if (!result?.isUpdateAvailable) {
                this.set({ status: 'current' })
                return
            }
            downloading = true
            this.set({ status: 'downloading', version: result.updateInfo.version, percent: 0 })
            await updater.downloadUpdate()
        } catch (error) {
            console.error('App update check/download failed', error)
            this.set({
                status: 'error',
                message: downloading
                    ? 'Could not download the update. Check your connection and try again.'
                    : 'Could not check for updates. Check your connection and try again.'
            })
        } finally {
            this.checking = false
        }
    }

    async install(): Promise<void> {
        if (!this.updater || this.state.status !== 'ready') return
        const version = this.state.version
        this.set({ status: 'installing', version })
        let prepared = false
        try {
            this.resume = await this.prepareInstall()
            prepared = true
            // The existing app quit handler drains/shuts down the local store.
            // No install-on-exit handler is registered; only this explicit action installs.
            this.updater.quitAndInstall(true, true)
        } catch (error) {
            console.error('App update preparation failed', error)
            this.resume?.()
            this.resume = undefined
            this.set({
                status: 'ready',
                version,
                error: prepared
                    ? 'Could not start the installer. Try updating again.'
                    : 'Could not save the journal. Retry updating after saving your writing.'
            })
        }
    }

    private set(state: AppUpdateState): void {
        this.state = state
        for (const listener of this.listeners) listener(state)
    }
}
