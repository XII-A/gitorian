import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'

const ignored = new Set(['.git', 'node_modules', '.cache', '.venv', 'venv', 'vendor', '__pycache__'])

export function repositoryPathKey(path: string): string {
    if (!path) return ''
    const key = normalize(resolve(path))
    return process.platform === 'win32' ? key.toLowerCase() : key
}

/** Discover working trees without following links or entering repository internals. */
export async function discoverRepositories(folder: string): Promise<{ paths: string[]; unreadable: string[] }> {
    const pending = [await realpath(folder)]
    const paths: string[] = []
    const unreadable: string[] = []
    while (pending.length) {
        const path = pending.pop()!
        try {
            const marker = await lstat(join(path, '.git')).catch((error: unknown) => {
                if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
                    return undefined
                throw error
            })
            if (marker?.isDirectory() || marker?.isFile()) {
                paths.push(path)
                continue
            }
            const children = await readdir(path, { withFileTypes: true })
            for (const child of children.sort((a, b) => b.name.localeCompare(a.name)))
                if (child.isDirectory() && !ignored.has(child.name)) pending.push(join(path, child.name))
        } catch {
            unreadable.push(path)
        }
    }
    return { paths, unreadable }
}
