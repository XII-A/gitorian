import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'

import { safeStorage } from 'electron'

export class Vault {
    private readonly session = new Map<string, string>()
    private readonly directory: string
    private readonly storage: typeof safeStorage
    constructor(directory: string, storage = safeStorage) {
        this.directory = directory
        this.storage = storage
    }
    protected(): boolean {
        return (
            this.storage.isEncryptionAvailable() &&
            !(process.platform === 'linux' && this.storage.getSelectedStorageBackend() === 'basic_text')
        )
    }
    get(service: string): string {
        if (this.session.has(service)) {
            return this.session.get(service) ?? ''
        }
        const path = nodePath.join(this.directory, `${service}.secret`)
        if (!this.protected() || !existsSync(path)) {
            return ''
        }
        try {
            return this.storage.decryptString(readFileSync(path))
        } catch {
            return ''
        }
    }
    set(service: string, token: string): void {
        this.session.set(service, token)
        const path = nodePath.join(this.directory, `${service}.secret`)
        if (!token) {
            if (existsSync(path)) {
                unlinkSync(path)
            }
            return
        }
        if (this.protected()) {
            writeFileSync(nodePath.join(this.directory, `${service}.secret`), this.storage.encryptString(token), {
                mode: 0o600
            })
        }
    }
}
