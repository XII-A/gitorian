import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
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
        this.session.set(service, token)
        const path = join(this.directory, `${service}.secret`)
        if (!token) {
            if (existsSync(path)) unlinkSync(path)
            return
        }
        if (this.protected())
            writeFileSync(join(this.directory, `${service}.secret`), safeStorage.encryptString(token), { mode: 0o600 })
    }
}
