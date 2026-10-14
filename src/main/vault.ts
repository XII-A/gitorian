import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'

import { safeStorage } from 'electron'

export class Vault {
    private readonly session = new Map<string, string>()
    private readonly directory: string
    constructor(directory: string) {
        this.directory = directory
    }
    protected(): boolean {
        return (
            safeStorage.isEncryptionAvailable() &&
            !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
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
            return safeStorage.decryptString(readFileSync(path))
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
            writeFileSync(nodePath.join(this.directory, `${service}.secret`), safeStorage.encryptString(token), {
                mode: 0o600
            })
        }
    }
}
