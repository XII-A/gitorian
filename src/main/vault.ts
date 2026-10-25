import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export class Vault {
    private readonly session = new Map<string, string>()
    constructor(private readonly directory: string) {}
    protected(): boolean {
        return (
            safeStorage.isEncryptionAvailable() &&
            !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
    }
    get(service: string): string {
        if (this.session.has(service)) return this.session.get(service) ?? ''
        const path = join(this.directory, `${service}.secret`)
        if (!this.protected() || !existsSync(path)) return ''
        try {
            return safeStorage.decryptString(readFileSync(path))
        } catch {
            return ''
        }
    }
    set(service: string, token: string): void {
        const path = join(this.directory, `${service}.secret`)
        if (!token) {
            if (existsSync(path)) unlinkSync(path)
            this.session.set(service, '')
            return
        }
        if (this.protected()) {
            const pending = `${path}.next`
            try {
                writeFileSync(pending, safeStorage.encryptString(token), { mode: 0o600 })
                renameSync(pending, path)
            } finally {
                if (existsSync(pending)) unlinkSync(pending)
            }
        }
        this.session.set(service, token)
    }
}
