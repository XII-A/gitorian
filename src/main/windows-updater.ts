import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { autoUpdater } from 'electron'
import electronUpdater from 'electron-updater'

/** NSIS's default handoff quits before its asynchronous spawn can fail. */
export class WindowsUpdater extends electronUpdater.NsisUpdater {
    private launching = false

    override quitAndInstall(silent = false, restart = false): void {
        if (this.launching) return
        this.launching = true
        void this.launch(silent, restart).then(
            () => {
                autoUpdater.emit('before-quit-for-update')
                this.app.quit()
            },
            (error: unknown) => {
                this.launching = false
                this.dispatchError(error instanceof Error ? error : new Error(String(error)))
            }
        )
    }

    private async launch(silent: boolean, restart: boolean): Promise<void> {
        const file = this.installerPath
        const info = this.downloadedUpdateHelper?.downloadedFileInfo
        if (!file || !info) throw new Error('The downloaded installer is unavailable')
        const args = ['--updated']
        if (silent) args.push('/S')
        if (silent ? restart : this.autoRunAppAfterInstall) args.push('--force-run')
        if (this.installDirectory) args.push(`/D=${this.installDirectory}`)
        const packageFile = this.downloadedUpdateHelper?.packageFile
        if (packageFile) args.push(`--package-file=${packageFile}`)
        const elevate = () => this.spawnLog(join(process.resourcesPath, 'elevate.exe'), [file, ...args])
        if (info.isAdminRightsRequired) {
            await elevate()
            return
        }
        try {
            await this.spawnLog(file, args)
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || !['EACCES', 'UNKNOWN'].includes(String(error.code)))
                throw error
            await elevate()
        }
    }

    // A PID can be allocated before Node emits a launch error. Wait for spawn.
    protected override spawnLog(file: string, args: string[] = []): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const child = spawn(file, args, { detached: true, stdio: 'ignore' })
            child.once('error', reject)
            child.once('spawn', () => {
                child.unref()
                resolve(true)
            })
        })
    }
}
